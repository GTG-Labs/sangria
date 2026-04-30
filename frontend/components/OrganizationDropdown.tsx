"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Building, Users, Plus } from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { internalFetch } from "@/lib/fetch";

export default function OrganizationDropdown() {
  const { userInfo, selectedOrgId, selectedOrg, setSelectedOrgId, refreshUserInfo } = useOrganization();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen]);
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [createError, setCreateError] = useState("");

  const handleOrganizationSelect = (orgId: string) => {
    setSelectedOrgId(orgId);
    setIsOpen(false);
  };

  const handleCreateOrganization = async () => {
    if (!newOrgName.trim() || isSubmitting) return;

    setCreateError("");
    setIsSubmitting(true);

    try {
      const response = await internalFetch("/api/backend/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newOrgName.trim() }),
      });

      if (response.ok) {
        const newOrg = await response.json();
        await refreshUserInfo();
        setSelectedOrgId(newOrg.id);
        setNewOrgName("");
        setIsCreating(false);
        setIsOpen(false);
      } else {
        const data = await response.json().catch((error) => {
          console.error('Failed to parse organization creation response:', error);
          return null;
        });
        setCreateError(data?.error || "Failed to create organization");
      }
    } catch (err) {
      console.error("Error creating organization:", err);
      setCreateError("Failed to create organization");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!userInfo || !selectedOrg) {
    return (
      <div className="flex items-center gap-3 px-2 py-2">
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Switch organization"
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-zinc-100"
      >
        <p className="truncate text-sm font-medium text-gray-900 flex-1 min-w-0">
          {selectedOrg.name}
        </p>
        <ChevronDown className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50">
          <div className="py-2">
            {/* Organization List */}
            {userInfo.organizations.map((org) => (
              <button
                key={org.id}
                onClick={() => handleOrganizationSelect(org.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left hover:bg-gray-50 ${selectedOrgId === org.id ? "bg-blue-50 text-blue-900" : "text-gray-700"
                  }`}
              >
                {org.isPersonal ? (
                  <Users className="h-4 w-4 flex-shrink-0" />
                ) : (
                  <Building className="h-4 w-4 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    {org.name}
                    {org.isPersonal && (
                      <span className="text-xs text-gray-400 ml-1">(Personal)</span>
                    )}
                  </div>
                  {org.isAdmin && (
                    <div className="text-xs text-blue-600 font-medium">Admin</div>
                  )}
                </div>
              </button>
            ))}

            {/* Divider */}
            <div className="border-t border-gray-200 my-2" />

            {/* Create New Organization */}
            {isCreating ? (
              <div className="px-4 py-2">
                <input
                  type="text"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="Organization name"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateOrganization();
                    } else if (e.key === 'Escape') {
                      setIsCreating(false);
                      setNewOrgName("");
                      setCreateError("");
                    }
                  }}
                  autoFocus
                />
                {createError && (
                  <p className="text-xs text-red-600 mt-1">{createError}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={handleCreateOrganization}
                    disabled={!newOrgName.trim() || isSubmitting}
                    className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => {
                      setIsCreating(false);
                      setNewOrgName("");
                      setCreateError("");
                    }}
                    className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsCreating(true)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
              >
                <Plus className="h-4 w-4" />
                <span>Add new organization</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}