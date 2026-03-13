import net from 'node:net';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { SOCKET_PATH } from './config.js';

// ── IPC Message Types ──

export interface RegisterMsg {
  type: 'register';
  sessionId: string;
  cwd: string;
  pid: number;
  project?: string;
  branch?: string;
}

export interface UnregisterMsg {
  type: 'unregister';
  sessionId: string;
}

export interface EventMsg {
  type: 'event';
  sessionId: string;
  event: string;
  data: unknown;
}

export interface PermissionRequestMsg {
  type: 'permission_request';
  sessionId: string;
  permissionId: string;
  toolName: string;
  toolInput: unknown;
  waitResponse?: boolean;
}

export interface PermissionResponseMsg {
  type: 'permission_response';
  permissionId: string;
  decision: 'allow' | 'deny';
  message?: string;
}

export type IPCMessage =
  | RegisterMsg
  | UnregisterMsg
  | EventMsg
  | PermissionRequestMsg
  | PermissionResponseMsg;

// ── IPC Server ──

export interface IPCServerEvents {
  register: [RegisterMsg];
  unregister: [UnregisterMsg];
  event: [EventMsg];
  permission_request: [PermissionRequestMsg, net.Socket];
  permission_response: [PermissionResponseMsg];
  error: [Error];
}

export class IPCServer extends EventEmitter<IPCServerEvents> {
  private server: net.Server | null = null;
  /** Sockets waiting for permission resolution. permissionId → socket */
  private waitingSockets = new Map<string, net.Socket>();

  async start(): Promise<void> {
    // Clean up stale socket
    try { fs.unlinkSync(SOCKET_PATH); } catch { /* not found */ }

    return new Promise((resolve, reject) => {
      this.server = net.createServer(socket => this.handleConnection(socket));
      this.server.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });
      this.server.listen(SOCKET_PATH, () => {
        fs.chmodSync(SOCKET_PATH, 0o600);
        console.log(`[ipc] Listening on ${SOCKET_PATH}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // Deny all waiting permissions
    for (const [id, socket] of this.waitingSockets) {
      this.sendResponse(socket, { decision: 'deny', message: 'Daemon shutting down' });
      this.waitingSockets.delete(id);
    }
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
      try { fs.unlinkSync(SOCKET_PATH); } catch { /* ok */ }
    });
  }

  /**
   * Send a permission decision back to a waiting hook script.
   * Returns true if the socket was found and response sent.
   */
  resolvePermission(permissionId: string, decision: 'allow' | 'deny', message?: string): boolean {
    const socket = this.waitingSockets.get(permissionId);
    if (!socket) return false;
    this.sendResponse(socket, { decision, message });
    this.waitingSockets.delete(permissionId);
    return true;
  }

  private handleConnection(socket: net.Socket): void {
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      // Process newline-delimited JSON
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (line) this.processMessage(line, socket);
      }
      // Handle case where message has no trailing newline
      if (buffer.trim()) {
        this.processMessage(buffer.trim(), socket);
        buffer = '';
      }
    });

    socket.on('error', () => {
      // Client disconnected — clean up any waiting sockets
      for (const [id, s] of this.waitingSockets) {
        if (s === socket) this.waitingSockets.delete(id);
      }
    });
  }

  private processMessage(raw: string, socket: net.Socket): void {
    let msg: IPCMessage;
    try {
      msg = JSON.parse(raw) as IPCMessage;
    } catch {
      console.warn('[ipc] Invalid JSON:', raw.slice(0, 200));
      return;
    }

    switch (msg.type) {
      case 'register':
        this.emit('register', msg);
        socket.end();
        break;
      case 'unregister':
        this.emit('unregister', msg);
        socket.end();
        break;
      case 'event':
        this.emit('event', msg);
        socket.end();
        break;
      case 'permission_request':
        if (msg.waitResponse) {
          // Hold socket open — response will come via resolvePermission()
          this.waitingSockets.set(msg.permissionId, socket);
          socket.on('close', () => {
            this.waitingSockets.delete(msg.permissionId);
          });
        } else {
          socket.end();
        }
        this.emit('permission_request', msg, socket);
        break;
      case 'permission_response':
        this.emit('permission_response', msg);
        socket.end();
        break;
      default:
        console.warn('[ipc] Unknown message type:', (msg as { type: string }).type);
        socket.end();
    }
  }

  private sendResponse(socket: net.Socket, data: { decision: string; message?: string }): void {
    try {
      socket.write(JSON.stringify(data) + '\n');
      socket.end();
    } catch {
      // Socket already closed
    }
  }
}
