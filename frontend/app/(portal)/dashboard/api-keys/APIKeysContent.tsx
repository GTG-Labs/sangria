"use client";

import { useState, useEffect } from "react";
import { Copy, Plus, Trash2, AlertCircle } from "lucide-react";

interface Merchant {
  id: string;
  user_id: string;
  api_key: string;
  name: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

interface CreateAPIKeyResponse {
  api_key: Merchant;
  key: string;
}

export default function APIKeysContent() {
  const [apiKeys, setApiKeys] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [createLoading, setCreateLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyIsLive, setNewKeyIsLive] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<string | null>(null);
  const [showNewKey, setShowNewKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fetchAPIKeys = async () => {
    try {
      const response = await fetch("/api/backend/api-keys");

      if (response.ok) {
        const keys = await response.json();
        setApiKeys(Array.isArray(keys) ? keys : []);
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        console.error("API Keys fetch failed:", response.status, errorData);
        setError(errorData.error || `Failed to load API keys (${response.status})`);
        setApiKeys([]); // Set empty array on error
      }
    } catch (err) {
      console.error("Failed to load API keys:", err);
      setError("Failed to load API keys");
      setApiKeys([]); // Set empty array on error
    } finally {
      setLoading(false);
    }
  };

  const createAPIKey = async () => {
    if (!newKeyName.trim()) return;

    setCreateLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/backend/api-keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newKeyName.trim(),
          is_live: newKeyIsLive,
        }),
      });

      if (response.ok) {
        const result: CreateAPIKeyResponse = await response.json();
        setNewKeyResult(result.key);
        setApiKeys([result.api_key, ...apiKeys]);
        setNewKeyName("");
        setNewKeyIsLive(false);
        setShowCreateForm(false);
        setShowNewKey(true);
      } else {
        const errorData = await response.json();
        setError(errorData.error || "Failed to create API key");
      }
    } catch (err) {
      setError("Failed to create API key");
    } finally {
      setCreateLoading(false);
    }
  };

  const revokeAPIKey = async (keyId: string) => {
    if (!confirm("Are you sure you want to revoke this API key? This action cannot be undone.")) {
      return;
    }

    try {
      const response = await fetch(`/api/backend/api-keys/${keyId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setApiKeys(apiKeys.filter(key => key.id !== keyId));
      } else {
        setError("Failed to revoke API key");
      }
    } catch (err) {
      setError("Failed to revoke API key");
    }
  };

  const copyToClipboard = async (text: string, keyId?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(keyId || text);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };

  // No masking needed - we just show the identifier as-is
  // Example: "sg_test_abc12345" (first 8 chars after prefix)

  useEffect(() => {
    fetchAPIKeys();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white"></div>
      </div>
    );
  }

  return (
    <main className="min-h-screen pt-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              API Keys
            </h1>
            <p className="mt-2 text-gray-600 dark:text-zinc-400">
              Manage your API keys for authenticating with Sangria services
            </p>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-sangria-500 text-white rounded-lg hover:bg-sangria-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create API Key
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {newKeyResult && showNewKey && (
          <div className="mb-6 p-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-1">
                <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-amber-800 dark:text-amber-200 mb-2">
                  API Key Created - Save It Now!
                </h3>
                <p className="text-amber-700 dark:text-amber-300 mb-4">
                  <strong>This is the only time you'll see your API key.</strong> Copy it now and store it securely. For security reasons, we cannot show it again.
                </p>
                <div className="flex items-center gap-2 p-4 bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-700 rounded-md font-mono text-sm break-all">
                  <span className="flex-1 select-all">{newKeyResult}</span>
                  <button
                    onClick={() => copyToClipboard(newKeyResult)}
                    className="flex-shrink-0 p-2 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 bg-amber-100 dark:bg-amber-900/30 rounded"
                  >
                    {copiedKey === newKeyResult ? (
                      <span className="text-xs font-medium">Copied!</span>
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div className="mt-4 flex gap-3">
                  <button
                    onClick={() => {
                      setShowNewKey(false);
                      setNewKeyResult(null);
                    }}
                    className="px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors text-sm font-medium"
                  >
                    I've saved this key
                  </button>
                  <button
                    onClick={() => copyToClipboard(newKeyResult)}
                    className="px-4 py-2 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 rounded-md hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors text-sm"
                  >
                    Copy again
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showCreateForm && (
          <div className="mb-6 p-6 border border-gray-200 dark:border-zinc-800 rounded-lg bg-white dark:bg-gray-800">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Create New API Key
            </h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="keyName" className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-2">
                  Key Name
                </label>
                <input
                  id="keyName"
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g., Production Server, Development Environment"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-zinc-400"
                  maxLength={255}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="isLive"
                  type="checkbox"
                  checked={newKeyIsLive}
                  onChange={(e) => setNewKeyIsLive(e.target.checked)}
                  className="rounded border-gray-300 dark:border-zinc-700"
                />
                <label htmlFor="isLive" className="text-sm text-gray-700 dark:text-zinc-300">
                  Live environment (production use)
                </label>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={createAPIKey}
                  disabled={createLoading || !newKeyName.trim()}
                  className="px-4 py-2 bg-sangria-500 text-white rounded-md hover:bg-sangria-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {createLoading ? "Creating..." : "Create Key"}
                </button>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewKeyName("");
                    setNewKeyIsLive(false);
                  }}
                  className="px-4 py-2 border border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 rounded-md hover:bg-gray-50 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          {!apiKeys || apiKeys.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500 dark:text-zinc-400 mb-2">
                No API keys found. Create your first API key to get started.
              </p>
              <p className="text-xs text-gray-400 dark:text-zinc-500 mb-4">
                API keys are shown in full only once during creation for security.
              </p>
              <button
                onClick={() => setShowCreateForm(true)}
                className="px-4 py-2 bg-sangria-500 text-white rounded-lg hover:bg-sangria-600 transition-colors"
              >
                Create API Key
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
                      Last Used
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-zinc-800">
                  {apiKeys.map((key) => (
                    <tr key={key.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {key.name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-zinc-400">
                          Created {new Date(key.created_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                            key.is_active
                              ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400"
                              : "bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400"
                          }`}
                        >
                          {key.is_active ? "Active" : "Revoked"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-zinc-400">
                        {key.last_used_at
                          ? new Date(key.last_used_at).toLocaleDateString()
                          : "Never"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-zinc-400">
                        {new Date(key.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        {key.is_active && (
                          <button
                            onClick={() => revokeAPIKey(key.id)}
                            className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                            title="Revoke this API key"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}