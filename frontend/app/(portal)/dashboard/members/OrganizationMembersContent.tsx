"use client";

import { useState, useEffect } from "react";
import { User, UserPlus, Crown, Mail, Building, Users, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useOrganization } from "@/contexts/OrganizationContext";
import { inviteSchema, type InviteData } from "@/lib/validation";
import { useSecureSubmit } from "@/lib/security-hooks";
import ArcadeButton from "@/components/ArcadeButton";
import { internalFetch } from "@/lib/fetch";

interface Member {
  user_id: string;
  organization_id: string;
  is_admin: boolean;
  joined_at: string;
  display_name: string; // Contains the user's display name (FirstName LastName) or email as fallback
  email?: string; // The email address from WorkOS (if provided)
}

export default function OrganizationMembersContent() {
  const { selectedOrg, selectedOrgId, userInfo } = useOrganization();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [isInviting, setIsInviting] = useState(false);
  const [removingMembers, setRemovingMembers] = useState<Set<string>>(new Set());
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    reset,
  } = useForm<InviteData>({
    resolver: zodResolver(inviteSchema),
    mode: "onChange",
  });


  // Secure submit with rate limiting
  const secureSubmit = useSecureSubmit(async (data: InviteData) => {
    await handleInviteInternal(data);
  }, {
    maxAttempts: 3, // Max 3 invitations per minute
    rateLimitWindow: 60000, // 1 minute window
  });

  useEffect(() => {
    if (selectedOrgId) {
      // Reset all form states when switching organizations
      setIsInviting(false);
      reset();

      // Reset list state before starting fetch
      setLoading(true);
      setMembers([]);

      // Create an AbortController for this fetch
      const controller = new AbortController();

      // Fetch members for the new organization
      fetchMembers(controller.signal);

      // Cleanup: abort the fetch if selectedOrgId changes or component unmounts
      return () => {
        controller.abort();
      };
    }
  }, [selectedOrgId, reset]);

  const fetchMembers = async (signal?: AbortSignal) => {
    if (!selectedOrgId) return;

    try {
      const response = await internalFetch(`/api/backend/organizations/${selectedOrgId}/members`, { signal });
      if (response.ok) {
        const data = await response.json();
        // Only update state if the fetch wasn't aborted
        if (!signal?.aborted) {
          setMembers(data.members || []);
        }
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error("Failed to fetch members:", err);
    } finally {
      // Only update loading state if not aborted
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  const handleInviteInternal = async (data: InviteData) => {
    if (!selectedOrgId) {
      throw new Error("No organization selected");
    }

    setSubmitError(null);

    try {
      const response = await internalFetch(`/api/backend/organizations/${selectedOrgId}/invitations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: data.email,
          message: data.message || null,
        }),
      });

      if (response.ok) {
        reset();
        setIsInviting(false);
        fetchMembers(); // Refresh the members list
      } else {
        const error = await response.json();
        throw new Error(error.error || "Failed to invite user");
      }
    } catch (err) {
      console.error("Error inviting user:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to invite user";
      setSubmitError(errorMessage);
      throw err; // Re-throw so secureSubmit can handle it
    }
  };

  const handleInvite = async (data: InviteData) => {
    try {
      await secureSubmit.secureSubmit(data);
    } catch (err) {
      // Error handling is done in handleInviteInternal
      console.error("Invite submission blocked:", err);
    }
  };

  const handleRemoveMember = async (memberUserId: string, memberName: string) => {
    if (!selectedOrgId || !confirm(`Are you sure you want to remove ${memberName} from this organization?`)) {
      return;
    }

    setRemovingMembers(prev => new Set(prev).add(memberUserId));

    try {
      const response = await internalFetch(`/api/backend/organizations/${selectedOrgId}/members/${memberUserId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        fetchMembers(); // Refresh the members list
      } else {
        const error = await response.json();
        alert(`Failed to remove member: ${error.error}`);
      }
    } catch (err) {
      console.error("Error removing member:", err);
      alert("Failed to remove member");
    } finally {
      setRemovingMembers(prev => {
        const newSet = new Set(prev);
        newSet.delete(memberUserId);
        return newSet;
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!selectedOrgId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Building className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Select an Organization</h3>
          <p className="text-gray-600">
            Please select an organization from the dropdown to view its members.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Organization Members</h1>
          <p className="text-gray-600 mt-1">
            {selectedOrg ? `Managing members for ${selectedOrg.name}` : "Manage your team members and their permissions"}
          </p>
        </div>
        {selectedOrg?.isAdmin && (
          <ArcadeButton onClick={() => setIsInviting(true)} variant="blue" size="sm">
            <UserPlus className="h-4 w-4 mr-1.5 inline" />
            Add Member
          </ArcadeButton>
        )}
      </div>

      {/* Organization Context Display */}
      {selectedOrg && (
        <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 px-4 py-3 rounded-lg">
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
      )}

      {/* Invite Form - Only show for admins */}
      {isInviting && selectedOrg?.isAdmin && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Invite New Member
          </h3>
          <form onSubmit={handleSubmit(handleInvite)} className="space-y-4">
            <div>
              <label htmlFor="inviteEmail" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                type="email"
                id="inviteEmail"
                {...register("email")}
                placeholder="Enter email address"
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${errors.email
                    ? "border-red-500 focus:ring-red-500"
                    : "border-gray-300 focus:ring-blue-500 focus:border-blue-500"
                  }`}
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
              )}
            </div>
            <div>
              <label htmlFor="inviteMessage" className="block text-sm font-medium text-gray-700 mb-2">
                Welcome Message (Optional)
              </label>
              <textarea
                id="inviteMessage"
                {...register("message")}
                placeholder="Add a personal welcome message..."
                rows={3}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${errors.message
                    ? "border-red-500 focus:ring-red-500"
                    : "border-gray-300 focus:ring-blue-500 focus:border-blue-500"
                  }`}
              />
              {errors.message && (
                <p className="mt-1 text-sm text-red-600">{errors.message.message}</p>
              )}
            </div>
            {/* Security Status Display */}
            {(secureSubmit.isBlocked || secureSubmit.attemptsRemaining() < 3 || submitError) && (
              <div className="p-3 border rounded-lg">
                {secureSubmit.isBlocked && (
                  <div className="flex items-center gap-2 text-red-600 text-sm">
                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                    Rate limit exceeded. Please wait {Math.ceil(secureSubmit.remainingCooldown() / 1000)} seconds.
                  </div>
                )}
                {!secureSubmit.isBlocked && secureSubmit.attemptsRemaining() < 3 && (
                  <div className="flex items-center gap-2 text-amber-600 text-sm">
                    <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
                    {secureSubmit.attemptsRemaining()} invitation attempts remaining this minute.
                  </div>
                )}
                {submitError && (
                  <div className="flex items-center gap-2 text-red-600 text-sm">
                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                    {submitError}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <ArcadeButton
                type="submit"
                disabled={!isValid || secureSubmit.isSubmitting || secureSubmit.isBlocked}
                variant="blue"
                size="sm"
              >
                {secureSubmit.isSubmitting && (
                  <span className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent inline-block mr-2" />
                )}
                {secureSubmit.isSubmitting ? "Sending..." : "Send Invitation"}
              </ArcadeButton>
              <button
                type="button"
                onClick={() => {
                  setIsInviting(false);
                  setSubmitError(null);
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

      {/* Members List */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">
            Members ({members.length})
          </h3>
        </div>

        {members.length === 0 ? (
          <div className="text-center py-12">
            <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No members yet</h3>
            <p className="text-gray-600 mb-6">
              Invite team members to collaborate on this organization.
            </p>
            {selectedOrg?.isAdmin && (
              <ArcadeButton onClick={() => setIsInviting(true)} variant="blue" size="sm">
                Add First Member
              </ArcadeButton>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {members.map((member, index) => (
              <div key={`${member.user_id}-${member.display_name}-${index}`} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                      <User className="h-5 w-5 text-gray-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {member.display_name || member.user_id || 'Unknown User'}
                        </span>
                        {member.is_admin && (
                          <Crown className="h-4 w-4 text-yellow-500" />
                        )}
                      </div>
                      <div className="text-sm text-gray-500">
                        {member.email && member.email !== member.display_name && (
                          <div className="flex items-center gap-1 mb-1">
                            <Mail className="h-3 w-3" />
                            <span>{member.email}</span>
                          </div>
                        )}
                        <p>
                          Joined {
                            member.joined_at
                              ? new Date(member.joined_at).toLocaleDateString()
                              : 'Unknown Date'
                          }
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {member.is_admin ? (
                      <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full">
                        Admin
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-full">
                        Member
                      </span>
                    )}

                    {/* Remove member button - only show for admins and not for the current user */}
                    {selectedOrg?.isAdmin &&
                      member.user_id !== userInfo?.id && (
                        <button
                          onClick={() => handleRemoveMember(member.user_id, member.display_name)}
                          disabled={removingMembers.has(member.user_id)}
                          className="p-1 text-red-600 hover:text-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Remove member from organization"
                        >
                          {removingMembers.has(member.user_id) ? (
                            <div className="w-4 h-4 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}