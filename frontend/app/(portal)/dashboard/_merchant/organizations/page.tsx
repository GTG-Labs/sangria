"use client";

import { useState, useEffect } from "react";
import { Building, Users, Plus, Settings, UserPlus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import ArcadeButton from "@/components/ArcadeButton";
import { organizationSchema, type OrganizationData } from "@/lib/validation";
import { internalFetch } from "@/lib/fetch";

interface Organization {
  id: string;
  name: string;
  isPersonal: boolean;
  isAdmin: boolean;
}

interface UserInfo {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  isAdmin: boolean;
  organizations: Organization[];
}

export default function OrganizationsPage() {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    reset,
  } = useForm<OrganizationData>({
    resolver: zodResolver(organizationSchema),
    mode: "onChange",
  });

  useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        const response = await internalFetch("/api/backend/me");
        if (response.ok) {
          const user = await response.json();
          setUserInfo(user);
        }
      } catch (err) {
        console.error("Failed to fetch user info:", err);
      }
    };

    fetchUserInfo();
  }, []);

  const handleCreateOrganization = async (data: OrganizationData) => {
    try {
      const response = await internalFetch("/api/backend/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: data.name })
      });

      if (response.ok) {
        const newOrg = await response.json();
        setUserInfo(prev => prev ? {
          ...prev,
          organizations: [...prev.organizations, newOrg]
        } : null);
        reset();
        setIsCreating(false);
      } else {
        console.error("Failed to create organization");
      }
    } catch (err) {
      console.error("Error creating organization:", err);
    }
  };

  if (!userInfo) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Organizations</h1>
          <p className="text-gray-600 mt-1">
            Manage your organizations and invite team members
          </p>
        </div>
        <ArcadeButton onClick={() => setIsCreating(true)} variant="blue" size="sm">
          <Plus className="h-4 w-4 mr-1.5 inline" />
          Create Organization
        </ArcadeButton>
      </div>

      {/* Create Organization Form */}
      {isCreating && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Create New Organization
          </h3>
          <form onSubmit={handleSubmit(handleCreateOrganization)} className="space-y-4">
            <div>
              <label htmlFor="orgName" className="block text-sm font-medium text-gray-700 mb-2">
                Organization Name
              </label>
              <input
                type="text"
                id="orgName"
                {...register("name")}
                placeholder="Enter organization name"
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  errors.name
                    ? "border-red-500 focus:ring-red-500"
                    : "border-gray-300 focus:ring-blue-500 focus:border-blue-500"
                }`}
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <ArcadeButton type="submit" disabled={!isValid} variant="blue" size="sm">
                Create
              </ArcadeButton>
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  reset();
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Organizations List */}
      <div className="grid gap-4">
        {userInfo.organizations.map((org) => (
          <div
            key={org.id}
            className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {org.isPersonal ? (
                  <Users className="h-8 w-8 text-blue-600" />
                ) : (
                  <Building className="h-8 w-8 text-green-600" />
                )}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {org.name}
                    {org.isPersonal && (
                      <span className="ml-2 text-sm text-gray-500 font-normal">(Personal)</span>
                    )}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    {org.isAdmin && (
                      <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded-full">
                        Admin
                      </span>
                    )}
                    <span className="text-sm text-gray-600">
                      {org.isPersonal ? "Personal organization" : "Team organization"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {org.isAdmin && !org.isPersonal && (
                  <button className="flex items-center gap-2 px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                    <UserPlus className="h-4 w-4" />
                    Invite Members
                  </button>
                )}
                {org.isAdmin && (
                  <button className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                    <Settings className="h-4 w-4" />
                    Settings
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {userInfo.organizations.length === 0 && (
        <div className="text-center py-12">
          <Building className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No organizations</h3>
          <p className="text-gray-600 mb-6">
            Create your first organization to get started with team collaboration.
          </p>
          <ArcadeButton onClick={() => setIsCreating(true)} variant="blue" size="sm">
            Create Organization
          </ArcadeButton>
        </div>
      )}
    </div>
  );
}