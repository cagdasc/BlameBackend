import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface DeviceInfoItem {
  serial: string;
  state: 'device' | 'offline' | 'unauthorized' | 'unknown';
  model?: string;
  product?: string;
  device?: string;
  transportId?: string;
}

export interface AdbConfig {
  adbPath: string;
  port: number;
  selectedSerial?: string;
}

export class AdbManager {
  private config: AdbConfig = {
    adbPath: 'adb',
    port: 10245,
    selectedSerial: ''
  };

  public getConfig(): AdbConfig {
    return { ...this.config };
  }

  public setConfig(newConfig: Partial<AdbConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Runs an ADB command using configured binary path and optional device serial
   */
  public async executeAdb(args: string[], overrideSerial?: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const finalArgs: string[] = [];

      const serialToUse = overrideSerial !== undefined ? overrideSerial : this.config.selectedSerial;

      // If a specific serial is selected and not already in args, inject `-s <serial>`
      if (serialToUse && !args.includes('-s')) {
        finalArgs.push('-s', serialToUse);
      }
      finalArgs.push(...args);

      execFile(this.config.adbPath, finalArgs, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          return reject({
            error,
            stdout: (stdout || '').trim(),
            stderr: (stderr || '').trim() || error.message
          });
        }
        resolve({
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim()
        });
      });
    });
  }

  /**
   * Tests ADB binary path and returns version info
   */
  public async checkAdb(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile(this.config.adbPath, ['version'], { timeout: 6000 }, (err, stdout, stderr) => {
          if (err) return reject({ err, stderr: stderr || err.message });
          resolve({ stdout: stdout || '', stderr: stderr || '' });
        });
      });
      return { ok: true, version: stdout.split('\n')[0] };
    } catch (err: any) {
      return {
        ok: false,
        error: err.stderr || err.error?.message || 'Could not execute ADB binary'
      };
    }
  }

  /**
   * Scans common default Android SDK platform-tools locations
   */
  public async autoDetectAdbPath(): Promise<string | null> {
    const home = os.homedir();
    const candidates: string[] = [];

    // Environment variables
    if (process.env.ANDROID_HOME) {
      candidates.push(path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb'));
      candidates.push(path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe'));
    }
    if (process.env.ANDROID_SDK_ROOT) {
      candidates.push(path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb'));
      candidates.push(path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb.exe'));
    }

    // Platform specific paths
    if (process.platform === 'darwin') {
      candidates.push(path.join(home, 'Library', 'Android', 'sdk', 'platform-tools', 'adb'));
      candidates.push('/opt/homebrew/bin/adb');
      candidates.push('/usr/local/bin/adb');
    } else if (process.platform === 'win32') {
      candidates.push(path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
      candidates.push('C:\\Android\\platform-tools\\adb.exe');
    } else {
      // Linux
      candidates.push(path.join(home, 'Android', 'Sdk', 'platform-tools', 'adb'));
      candidates.push('/usr/bin/adb');
      candidates.push('/usr/local/bin/adb');
    }

    // First check candidate paths that exist on disk
    for (const cand of candidates) {
      if (cand && fs.existsSync(cand)) {
        try {
          fs.accessSync(cand, fs.constants.X_OK);
          return cand;
        } catch {
          // not executable or accessible
        }
      }
    }

    // Fall back to testing standard PATH 'adb'
    try {
      const res = await this.checkAdb();
      if (res.ok) return 'adb';
    } catch {
      // failed
    }

    return null;
  }

  /**
   * Parses `adb devices -l`
   */
  public async getDevices(): Promise<DeviceInfoItem[]> {
    const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile(this.config.adbPath, ['devices', '-l'], { timeout: 6000 }, (err, stdout, stderr) => {
        if (err) return reject({ err, stderr: stderr || err.message });
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      });
    });

    const lines = stdout.split('\n');
    const devices: DeviceInfoItem[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const serial = parts[0];
        const state = parts[1] as DeviceInfoItem['state'];

        let model = '';
        let product = '';
        let device = '';
        let transportId = '';

        for (let j = 2; j < parts.length; j++) {
          const item = parts[j];
          if (item.startsWith('model:')) model = item.substring(6);
          else if (item.startsWith('product:')) product = item.substring(8);
          else if (item.startsWith('device:')) device = item.substring(7);
          else if (item.startsWith('transport_id:')) transportId = item.substring(13);
        }

        devices.push({
          serial,
          state,
          model: model || serial,
          product,
          device,
          transportId
        });
      }
    }

    return devices;
  }

  /**
   * Reverses device TCP port to local host TCP port:
   * `adb reverse tcp:<port> tcp:<port>`
   * Allows apps inside Android device/emulator to reach host's TCP server at 127.0.0.1:<port>
   */
  public async reversePort(port: number = this.config.port, serial?: string): Promise<{ success: boolean; output: string }> {
    try {
      const { stdout } = await this.executeAdb(['reverse', `tcp:${port}`, `tcp:${port}`], serial);
      this.config.port = port;
      if (serial) {
        this.config.selectedSerial = serial;
      }
      return { success: true, output: stdout || `Reversed device tcp:${port} -> host tcp:${port} on device ${serial || 'default'}` };
    } catch (err: any) {
      throw new Error(err.stderr || err.error?.message || 'Failed to reverse port');
    }
  }

  /**
   * Lists active port reverse rules (`adb reverse --list`)
   */
  public async listReverses(): Promise<string[]> {
    try {
      const { stdout } = await this.executeAdb(['reverse', '--list']);
      return stdout.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Removes reverse rule (`adb reverse --remove tcp:<port>`)
   */
  public async removeReverse(port: number = this.config.port, serial?: string): Promise<{ success: boolean; output: string }> {
    try {
      const { stdout } = await this.executeAdb(['reverse', '--remove', `tcp:${port}`], serial);
      return { success: true, output: stdout || `Removed reverse rule for tcp:${port}` };
    } catch (err: any) {
      throw new Error(err.stderr || err.error?.message || 'Failed to remove reverse rule');
    }
  }

  /**
   * Forwards local TCP port to device TCP port
   */
  public async forwardPort(port: number = this.config.port, serial?: string): Promise<{ success: boolean; output: string }> {
    try {
      const { stdout } = await this.executeAdb(['forward', `tcp:${port}`, `tcp:${port}`], serial);
      this.config.port = port;
      if (serial) {
        this.config.selectedSerial = serial;
      }
      return { success: true, output: stdout || `Forwarded tcp:${port} -> tcp:${port} on device ${serial || 'default'}` };
    } catch (err: any) {
      throw new Error(err.stderr || err.error?.message || 'Failed to forward port');
    }
  }

  /**
   * Kills and restarts the ADB daemon: `adb kill-server` followed by `adb start-server`
   */
  public async restartServer(): Promise<{ success: boolean; output: string }> {
    try {
      await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile(this.config.adbPath, ['kill-server'], { timeout: 8000 }, (err, stdout, stderr) => {
          if (err) return reject({ err, stderr: stderr || err.message });
          resolve({ stdout: stdout || '', stderr: stderr || '' });
        });
      });

      const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile(this.config.adbPath, ['start-server'], { timeout: 10000 }, (err, stdout, stderr) => {
          if (err) return reject({ err, stderr: stderr || err.message });
          resolve({ stdout: stdout || '', stderr: stderr || '' });
        });
      });

      return { success: true, output: stdout || 'ADB server killed and restarted successfully.' };
    } catch (err: any) {
      throw new Error(err.stderr || err.error?.message || 'Failed to restart ADB server');
    }
  }

  /**
   * Lists active port forward rules
   */
  public async listForwards(): Promise<string[]> {
    try {
      const { stdout } = await this.executeAdb(['forward', '--list']);
      return stdout.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Removes forward rule
   */
  public async removeForward(port: number = this.config.port): Promise<{ success: boolean; output: string }> {
    try {
      const { stdout } = await this.executeAdb(['forward', '--remove', `tcp:${port}`]);
      return { success: true, output: stdout || `Removed forward rule for tcp:${port}` };
    } catch (err: any) {
      throw new Error(err.stderr || err.error?.message || 'Failed to remove forward rule');
    }
  }
}

export const adbManager = new AdbManager();
