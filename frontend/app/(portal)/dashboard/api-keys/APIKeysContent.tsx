"use client";

import { useState, useEffect } from "react";
import { Copy, Plus, Trash2, AlertCircle, Check, X, Users, Crown } from "lucide-react";
import ArcadeButton from "@/components/ArcadeButton";
import { useOrganization } from "@/contexts/OrganizationContext";

const API_KEY_STATUS = {
  ACTIVE: "active",
  PENDING: "pending",
  INACTIVE: "inactive",
} as const;

type APIKeyStatus = (typeof API_KEY_STATUS)[keyof typeof API_KEY_STATUS];

interface APIKey {
  id: string;
  organization_id: string;
  name: string;
  key_id: string;
  api_key?: string; // Only present during creation
  status: APIKeyStatus;
  last_used_at: string | null;
  created_at: string;
}


export default function APIKeysContent() {
  const { selectedOrg, selectedOrgId, userInfo } = useOrganization();
  const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createLoading, setCreateLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyResult, setNewKeyResult] = useState<string | null>(null);
  const [showNewKey, setShowNewKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [approvalLoading, setApprovalLoading] = useState<Set<string>>(new Set());

  const resetCreateForm = () => {
    setNewKeyName("");
    setShowCreateForm(false);
  };


  const fetchAPIKeys = async (showLoading = true, signal?: AbortSignal) => {
    if (showLoading) {
      setLoading(true);
    }

    try {
      const orgParam = selectedOrgId ? `?org_id=${selectedOrgId}` : "";
      const response = await fetch(`/api/backend/api-keys${orgParam}`, { signal });

      if (signal?.aborted) return;

      if (response.ok) {
        const keys = await response.json();
        setApiKeys(Array.isArray(keys) ? keys : []);
        setError(null); // Clear any previous errors
      } else {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        console.error("API Keys fetch failed:", response.status, errorData);
        setError(
          errorData.error || `Failed to load API keys (${response.status})`,
        );
        setApiKeys([]);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("Failed to load API keys:", err);
      setError("Failed to load API keys");
      setApiKeys([]);
    } finally {
      if (!signal?.aborted && showLoading) {
        setLoading(false);
      }
    }
  };

  const createAPIKey = async () => {
    if (!newKeyName.trim()) return;

    setCreateLoading(true);
    setError(null);

    try {
      const orgParam = selectedOrgId ? `?org_id=${selectedOrgId}` : "";
      const response = await fetch(`/api/backend/merchants${orgParam}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newKeyName.trim(),
        }),
      });

      if (response.ok || response.status === 202) {
        const result: APIKey = await response.json();

        // The actual API key string is in result.api_key (based on backend response)
        // This is available for both active (201) and pending (202) keys
        if (result.api_key) {
          setNewKeyResult(result.api_key);
          setShowNewKey(true);
        } else {
          console.warn("No API key string found in response:", result);
        }

        // Always refresh the list after creating to ensure we have the latest data
        await fetchAPIKeys(false);
        resetCreateForm();
      } else {
        const errorData = await response.json();
        setError(errorData.error || "Failed to create API key");
      }
    } catch {
      setError("Failed to create API key");
    } finally {
      setCreateLoading(false);
    }
  };

  const revokeAPIKey = async (keyId: string) => {
    if (
      !confirm(
        "Are you sure you want to revoke this API key? This action cannot be undone.",
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/backend/api-keys/${keyId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        // Refresh the list to ensure we have the latest state
        await fetchAPIKeys(false);
      } else {
        setError("Failed to revoke API key");
      }
    } catch {
      setError("Failed to revoke API key");
    }
  };

  const approveAPIKey = async (keyId: string) => {
    setApprovalLoading(prev => new Set(prev).add(keyId));

    try {
      const response = await fetch(`/api/backend/api-keys/${keyId}/approve`, {
        method: "POST",
      });

      if (response.ok) {
        // Refresh the list to show the updated status
        await fetchAPIKeys(false);
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        setError(errorData.error || "Failed to approve API key");
      }
    } catch {
      setError("Failed to approve API key");
    } finally {
      setApprovalLoading(prev => {
        const newSet = new Set(prev);
        newSet.delete(keyId);
        return newSet;
      });
    }
  };

  const rejectAPIKey = async (keyId: string) => {
    setApprovalLoading(prev => new Set(prev).add(keyId));

    try {
      const response = await fetch(`/api/backend/api-keys/${keyId}/reject`, {
        method: "POST",
      });

      if (response.ok) {
        // Refresh the list to show the updated status
        await fetchAPIKeys(false);
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        setError(errorData.error || "Failed to reject API key");
      }
    } catch {
      setError("Failed to reject API key");
    } finally {
      setApprovalLoading(prev => {
        const newSet = new Set(prev);
        newSet.delete(keyId);
        return newSet;
      });
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

  const copyNewKey = () => copyToClipboard(newKeyResult!);

  useEffect(() => {
    if (!selectedOrgId) return;

    const controller = new AbortController();

    // Reset all form and alert states when switching organizations
    setShowCreateForm(false);
    setNewKeyName("");
    setNewKeyResult(null);
    setShowNewKey(false);
    setError(null);
    setCopiedKey(null);
    setApprovalLoading(new Set());

    // Fetch API keys for the new organization
    fetchAPIKeys(true, controller.signal);

    return () => controller.abort();
  }, [selectedOrgId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-col gap-4 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight text-gray-900">
              API Keys
            </h1>
            <p className="mt-2 text-gray-500">
              Manage your API keys for authenticating with Sangria services.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <ArcadeButton onClick={() => setShowCreateForm(true)} size="sm" variant="blue">
              <Plus className="w-3.5 h-3.5 mr-1.5 inline" />
              Create API Key
            </ArcadeButton>
          </div>
        </div>

        {userInfo && selectedOrg && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Users className="w-4 h-4" />
              <span>
                Organization: <strong>{selectedOrg.name}</strong>
              </span>
              {selectedOrg.isAdmin && (
                <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                  <Crown className="w-3 h-3 inline mr-1" />
                  Admin
                </span>
              )}
            </div>

            {/* Info box about API key approval process */}
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                {selectedOrg.isAdmin ? (
                  <>
                    <strong>Admin privileges:</strong> Your API keys are automatically activated upon creation.
                    You can also approve or reject pending keys from other team members.
                  </>
                ) : (
                  <>
                    <strong>Member privileges:</strong> New API keys require admin approval before they become active.
                    Contact your organization admin to approve pending keys.
                  </>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {newKeyResult && showNewKey && (
        <div className="mb-6 p-6 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-1">
              <svg
                className="w-5 h-5 text-amber-600"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-amber-800 mb-2">
                API Key Created - Save It Now!
              </h3>
              <p className="text-amber-700 mb-4">
                <strong>
                  This is the only time you&apos;ll see your API key.
                </strong>{" "}
                Copy it now and store it securely. For security reasons, we
                cannot show it again.
              </p>
              <div className="flex items-center gap-2 p-4 bg-white border border-amber-200 rounded-md font-mono text-sm break-all">
                <span className="flex-1 select-all">{newKeyResult}</span>
                <button
                  onClick={copyNewKey}
                  className="flex-shrink-0 p-2 text-amber-600 hover:text-amber-800 bg-amber-100 rounded"
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
                  I&apos;ve saved this key
                </button>
                <button
                  onClick={copyNewKey}
                  className="px-4 py-2 border border-amber-300 text-amber-700 rounded-md hover:bg-amber-50 transition-colors text-sm"
                >
                  Copy again
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCreateForm && (
        <div className="mb-6 p-6 border border-gray-200 rounded-lg bg-white">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Create New API Key
          </h3>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="keyName"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Key Name
              </label>
              <input
                id="keyName"
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Production Server, Development Environment"
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900 placeholder-gray-500"
                maxLength={255}
              />
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
                onClick={resetCreateForm}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {!apiKeys || apiKeys.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500 mb-2">
              No API keys found. Create your first API key to get started.
            </p>
            <p className="text-xs text-gray-400 mb-4">
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
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Used
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {apiKeys.map((key, index) => (
                  <tr key={key.id || `key-${index}`}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {key.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        Created {new Date(key.created_at).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                          key.status === API_KEY_STATUS.ACTIVE
                            ? "bg-green-100 text-green-800"
                            : key.status === API_KEY_STATUS.PENDING
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {key.status === API_KEY_STATUS.ACTIVE ? 'Active' :
                         key.status === API_KEY_STATUS.PENDING ? 'Pending' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {key.last_used_at
                        ? new Date(key.last_used_at).toLocaleDateString()
                        : "Never"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(key.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Admin approval actions for pending keys */}
                        {key.status === API_KEY_STATUS.PENDING && selectedOrg?.isAdmin && (
                          <>
                            <button
                              onClick={() => approveAPIKey(key.id)}
                              disabled={approvalLoading.has(key.id)}
                              className="p-1 text-green-600 hover:text-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Approve this API key"
                              aria-label="Approve this API key"
                            >
                              {approvalLoading.has(key.id) ? (
                                <div className="w-4 h-4 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
                              ) : (
                                <Check className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              onClick={() => rejectAPIKey(key.id)}
                              disabled={approvalLoading.has(key.id)}
                              className="p-1 text-red-600 hover:text-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Reject this API key"
                              aria-label="Reject this API key"
                            >
                              {approvalLoading.has(key.id) ? (
                                <div className="w-4 h-4 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
                              ) : (
                                <X className="w-4 h-4" />
                              )}
                            </button>
                          </>
                        )}

                        {/* Revoke action for active keys */}
                        {key.status === API_KEY_STATUS.ACTIVE && (
                          <button
                            onClick={() => revokeAPIKey(key.id)}
                            className="p-1 text-red-600 hover:text-red-800"
                            title="Revoke this API key"
                            aria-label="Revoke this API key"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}

                        {/* Show status message for pending keys (non-admin users) */}
                        {key.status === API_KEY_STATUS.PENDING && !selectedOrg?.isAdmin && (
                          <span className="text-xs text-yellow-600 font-medium">Awaiting approval</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
