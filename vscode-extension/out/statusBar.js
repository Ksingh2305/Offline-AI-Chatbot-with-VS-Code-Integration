"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusBar = void 0;
const vscode = __importStar(require("vscode"));
class StatusBar {
    constructor(client) {
        this.client = client;
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = "localforge.openChat";
        this.item.show();
        this.poll();
    }
    poll() {
        this.check();
        this.timer = setInterval(() => this.check(), 10000);
    }
    async check() {
        const alive = await this.client.isAlive();
        if (alive) {
            this.item.text = "$(check) LocalForge";
            this.item.tooltip = "LocalForge engine is running — click to open chat";
            this.item.backgroundColor = undefined;
            this.item.color = new vscode.ThemeColor("statusBarItem.prominentForeground");
        }
        else {
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
exports.StatusBar = StatusBar;
//# sourceMappingURL=statusBar.js.map