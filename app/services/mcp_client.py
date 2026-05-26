"""MCP (Model Context Protocol) client for MyAi.

Manages stdio-based MCP server processes. Each server is started on first
call and kept alive for the session. Communicates via JSON-RPC 2.0 over
stdin/stdout.

Supports: @anthropic/mcp-gmail, @anthropic/mcp-google-calendar,
@anthropic/mcp-google-drive, @anthropic/mcp-filesystem, and any
other MCP server that uses stdio transport.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).parent.parent.parent / "config" / "mcp_servers.json"


class MCPServerProcess:
    """Manages a single MCP server subprocess."""

    def __init__(self, name: str, command: str, args: list[str], env: dict | None = None):
        self.name = name
        self.command = command
        self.args = args
        self.env = env
        self._proc: asyncio.subprocess.Process | None = None
        self._request_id = 0
        self._lock = asyncio.Lock()

    async def start(self) -> bool:
        if self._proc and self._proc.returncode is None:
            return True
        try:
            full_env = {**os.environ, **(self.env or {})}
            self._proc = await asyncio.create_subprocess_exec(
                self.command, *self.args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=full_env,
                creationflags=0x08000000 if os.name == "nt" else 0,
            )
            # Send initialize request
            init_resp = await self._send({
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "MyAi", "version": "0.4.0"},
                },
            })
            if init_resp and "error" not in init_resp:
                # Send initialized notification
                await self._notify({"method": "notifications/initialized"})
                logger.info(f"MCP server '{self.name}' started")
                return True
            logger.warning(f"MCP server '{self.name}' init failed: {init_resp}")
            return False
        except FileNotFoundError:
            logger.warning(f"MCP server '{self.name}': command '{self.command}' not found")
            return False
        except Exception as e:
            logger.warning(f"MCP server '{self.name}' start failed: {e}")
            return False

    async def stop(self):
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.terminate()
                await asyncio.wait_for(self._proc.wait(), timeout=5)
            except Exception:
                self._proc.kill()
            self._proc = None

    async def list_tools(self) -> list[dict]:
        resp = await self._send({"method": "tools/list", "params": {}})
        if resp and "result" in resp:
            return resp["result"].get("tools", [])
        return []

    async def call_tool(self, tool_name: str, arguments: dict) -> str:
        resp = await self._send({
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        })
        if resp and "result" in resp:
            content = resp["result"].get("content", [])
            texts = [c.get("text", "") for c in content if c.get("type") == "text"]
            return "\n".join(texts) if texts else json.dumps(resp["result"])
        if resp and "error" in resp:
            return f"MCP error: {resp['error'].get('message', str(resp['error']))}"
        return "MCP call returned no response"

    async def _send(self, message: dict, timeout: float = 30) -> dict | None:
        async with self._lock:
            if not self._proc or self._proc.returncode is not None:
                return None
            self._request_id += 1
            request = {"jsonrpc": "2.0", "id": self._request_id, **message}
            line = json.dumps(request) + "\n"
            try:
                self._proc.stdin.write(line.encode())
                await self._proc.stdin.drain()
                raw = await asyncio.wait_for(self._proc.stdout.readline(), timeout=timeout)
                if raw:
                    return json.loads(raw.decode())
                return None
            except asyncio.TimeoutError:
                logger.warning(f"MCP '{self.name}' timed out")
                return None
            except Exception as e:
                logger.warning(f"MCP '{self.name}' communication error: {e}")
                return None

    async def _notify(self, message: dict):
        if not self._proc or self._proc.returncode is not None:
            return
        notif = {"jsonrpc": "2.0", **message}
        line = json.dumps(notif) + "\n"
        try:
            self._proc.stdin.write(line.encode())
            await self._proc.stdin.drain()
        except Exception:
            pass


class MCPClient:
    """Manages multiple MCP server connections."""

    def __init__(self):
        self._servers_config: dict[str, dict] = {}
        self._processes: dict[str, MCPServerProcess] = {}
        self._config_path = CONFIG_PATH

    @property
    def is_configured(self) -> bool:
        return len(self._servers_config) > 0

    def load_config(self):
        if self._config_path.exists():
            try:
                with open(self._config_path, "r") as f:
                    config = json.load(f)
                self._servers_config = config.get("servers", {})
                logger.info(f"Loaded {len(self._servers_config)} MCP server configs")
            except Exception as e:
                logger.warning(f"Failed to load MCP config: {e}")

    async def get_server(self, name: str) -> MCPServerProcess | None:
        if name in self._processes:
            proc = self._processes[name]
            if proc._proc and proc._proc.returncode is None:
                return proc

        config = self._servers_config.get(name)
        if not config:
            return None

        command = config.get("command", "")
        args = config.get("args", [])
        env = config.get("env")

        # Check if command exists
        if not shutil.which(command):
            return None

        proc = MCPServerProcess(name, command, args, env)
        if await proc.start():
            self._processes[name] = proc
            return proc
        return None

    async def call_tool(self, server_name: str, tool_name: str, arguments: dict) -> str:
        server = await self.get_server(server_name)
        if not server:
            config = self._servers_config.get(server_name, {})
            desc = config.get("description", server_name)
            requires = config.get("requires", "")
            cmd = config.get("command", "")

            if not shutil.which(cmd):
                return (
                    f"MCP server '{server_name}' requires '{cmd}' which is not installed.\n"
                    f"To set up {desc}:\n"
                    f"1. Install Node.js from https://nodejs.org\n"
                    f"2. The server will be auto-installed on first use via npx.\n"
                    + (f"3. {requires}\n" if requires else "")
                )
            return f"MCP server '{server_name}' failed to start. Check logs."

        return await server.call_tool(tool_name, arguments)

    async def discover_tools(self, server_name: str | None = None) -> list[dict]:
        all_tools = []
        targets = [server_name] if server_name else list(self._servers_config.keys())

        for name in targets:
            server = await self.get_server(name)
            if server:
                tools = await server.list_tools()
                for t in tools:
                    t["_server"] = name
                all_tools.extend(tools)

        return all_tools

    def list_servers(self) -> list[dict]:
        result = []
        for name, config in self._servers_config.items():
            cmd = config.get("command", "")
            result.append({
                "name": name,
                "description": config.get("description", ""),
                "command": cmd,
                "available": bool(shutil.which(cmd)),
                "running": name in self._processes and self._processes[name]._proc is not None,
                "requires": config.get("requires", ""),
                "setup_url": config.get("setup_url", ""),
            })
        return result

    async def stop_all(self):
        for proc in self._processes.values():
            await proc.stop()
        self._processes.clear()


_singleton: MCPClient | None = None


def get_mcp_client() -> MCPClient:
    global _singleton
    if _singleton is None:
        _singleton = MCPClient()
        _singleton.load_config()
    return _singleton
