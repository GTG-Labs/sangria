import express from "express";

const app = express();
app.use(express.json());


// Free tier - service info
app.get("/", (_req, res) => {
  res.json({
    service: "E2B API",
    tagline: "Code execution sandboxes for AI agents",
    version: "1.0.0",
    description: "Secure, scalable code execution environments",
    features: [
      "Python, Node.js, and Bash execution",
      "Isolated sandbox environments",
      "Real-time output streaming",
      "File system access",
      "Network capabilities"
    ],
    endpoints: {
      "/": "API info (free)",
      "/execute/python": "$0.05 - Run Python code",
      "/execute/node": "$0.05 - Run Node.js code",
      "/execute/bash": "$0.03 - Run bash commands",
      "/sandbox/create": "$0.10 - Create new sandbox session",
      "/sandbox/:id/files": "Free - File operations in session"
    },
    documentation: "https://e2b.dev/docs"
  });
});

// Python execution - $0.05
app.post(
  "/execute/python",
  async (req, res) => {
    const { code, timeout = 30 } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    // Simulate E2B-style execution
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Mock different types of Python code responses
    let result;
    if (code.includes("print")) {
      const outputs = code.match(/print\((.*?)\)/g) || [];
      result = {
        success: true,
        stdout: outputs.map((p: string) => p.replace(/print\(["']?(.*?)["']?\)/, "$1")).join("\n") + "\n",
        stderr: "",
        exit_code: 0
      };
    } else if (code.includes("import")) {
      result = {
        success: true,
        stdout: "Modules imported successfully\n",
        stderr: "",
        exit_code: 0
      };
    } else if (code.includes("error") || code.includes("raise")) {
      result = {
        success: false,
        stdout: "",
        stderr: "Traceback (most recent call last):\n  File \"<stdin>\", line 1, in <module>\nError: Simulated error\n",
        exit_code: 1
      };
    } else {
      result = {
        success: true,
        stdout: "Code executed successfully\n",
        stderr: "",
        exit_code: 0
      };
    }

    res.json({
      execution_id: executionId,
      language: "python",
      code,
      timeout,
      ...result,
      execution_time_ms: Math.floor(Math.random() * 1000) + 50,
      sandbox_id: `sandbox_${Math.random().toString(36).substr(2, 8)}`,
      timestamp: new Date().toISOString()
    });
  }
);

// Node.js execution - $0.05
app.post(
  "/execute/node",
  async (req, res) => {
    const { code, timeout = 30 } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    let result;
    if (code.includes("console.log")) {
      const outputs = code.match(/console\.log\((.*?)\)/g) || [];
      result = {
        success: true,
        stdout: outputs.map((c: string) => c.replace(/console\.log\((.*?)\)/, "$1").replace(/['"]/g, "")).join("\n") + "\n",
        stderr: "",
        exit_code: 0
      };
    } else if (code.includes("require") || code.includes("import")) {
      result = {
        success: true,
        stdout: "Modules loaded successfully\n",
        stderr: "",
        exit_code: 0
      };
    } else {
      result = {
        success: true,
        stdout: "undefined\n",
        stderr: "",
        exit_code: 0
      };
    }

    res.json({
      execution_id: executionId,
      language: "node",
      code,
      timeout,
      ...result,
      execution_time_ms: Math.floor(Math.random() * 800) + 30,
      sandbox_id: `sandbox_${Math.random().toString(36).substr(2, 8)}`,
      timestamp: new Date().toISOString()
    });
  }
);

// Bash execution - $0.03
app.post(
  "/execute/bash",
  async (req, res) => {
    const { command, timeout = 30 } = req.body;

    if (!command) {
      return res.status(400).json({ error: "Command is required" });
    }

    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    let result;
    if (command.startsWith("ls")) {
      result = {
        success: true,
        stdout: "app.py\ndata.json\nrequirements.txt\nutils.js\n",
        stderr: "",
        exit_code: 0
      };
    } else if (command.startsWith("pwd")) {
      result = {
        success: true,
        stdout: "/home/sandbox\n",
        stderr: "",
        exit_code: 0
      };
    } else if (command.startsWith("echo")) {
      const text = command.replace("echo ", "").replace(/['"]/g, "");
      result = {
        success: true,
        stdout: text + "\n",
        stderr: "",
        exit_code: 0
      };
    } else {
      result = {
        success: true,
        stdout: `Executed: ${command}\n`,
        stderr: "",
        exit_code: 0
      };
    }

    res.json({
      execution_id: executionId,
      command,
      timeout,
      ...result,
      execution_time_ms: Math.floor(Math.random() * 500) + 20,
      sandbox_id: `sandbox_${Math.random().toString(36).substr(2, 8)}`,
      timestamp: new Date().toISOString()
    });
  }
);

// Sandbox creation - $0.10
app.post(
  "/sandbox/create",
  async (req, res) => {
    const { template = "base", ttl_minutes = 30 } = req.body;

    const sandboxId = `sb_${Date.now()}_${Math.random().toString(36).substr(2, 12)}`;

    res.json({
      sandbox_id: sandboxId,
      template,
      status: "running",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + ttl_minutes * 60 * 1000).toISOString(),
      connection_url: `wss://coderunner.example.com/sandbox/${sandboxId}`,
      capabilities: ["python", "node", "bash", "filesystem"],
      resource_limits: {
        cpu_cores: 1,
        memory_mb: 512,
        disk_mb: 1024,
        network_enabled: true
      }
    });
  }
);

// File operations - Free (within session)
app.get("/sandbox/:sandboxId/files", (req, res) => {
  const { sandboxId } = req.params;

  res.json({
    sandbox_id: sandboxId,
    files: [
      {
        name: "main.py",
        type: "file",
        size: 1024,
        modified: "2026-05-05T10:30:00Z"
      },
      {
        name: "data",
        type: "directory",
        modified: "2026-05-05T09:15:00Z"
      },
      {
        name: "output.txt",
        type: "file",
        size: 256,
        modified: "2026-05-05T11:00:00Z"
      }
    ]
  });
});

const PORT = Number(process.env.PORT ?? 4006);
app.listen(PORT, () => {
  console.log(`\n🚀 E2B API - Code Execution Sandboxes`);
  console.log(`⚡ Server running on http://localhost:${PORT}`);
  console.log(`\n📋 Available Endpoints:`);
  console.log(`  GET  /                        → API info (FREE)`);
  console.log(`  POST /execute/python          → Python execution ($0.05)`);
  console.log(`  POST /execute/node            → Node.js execution ($0.05)`);
  console.log(`  POST /execute/bash            → Bash execution ($0.03)`);
  console.log(`  POST /sandbox/create          → Create sandbox ($0.10)`);
  console.log(`  GET  /sandbox/:id/files       → List files (FREE)`);
  console.log(`\n💰 Pay-per-execution model for AI agents`);
  console.log(`🛡️  Secure, isolated sandbox environments`);
});