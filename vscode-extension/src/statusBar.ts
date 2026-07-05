import * as vscode from "vscode";
import { EngineClient } from "./client";

export class StatusBar {
  private item: vscode.StatusBarItem;
  private client: EngineClient;
  private timer?: NodeJS.Timeout;

  constructor(client: EngineClient) {
    this.client = client;
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = "localforge.openChat";
    this.item.show();
    this.poll();
  }

  private poll() {
    this.check();
    this.timer = setInterval(() => this.check(), 10_000);
  }

  private async check() {
    const alive = await this.client.isAlive();
    if (alive) {
      this.item.text = "$(check) LocalForge";
      this.item.tooltip = "LocalForge engine is running — click to open chat";
      this.item.backgroundColor = undefined;
      this.item.color = new vscode.ThemeColor("statusBarItem.prominentForeground");
    } else {
      this.item.text = "$(warning) LocalForge offline";
      this.item.tooltip = "LocalForge engine is not reachable — is the desktop app running?";
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    }
  }

  dispose() {
    clearInterval(this.timer);
    this.item.dispose();
  }
}
