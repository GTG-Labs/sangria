"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
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

interface OrganizationContextType {
  userInfo: UserInfo | null;
  selectedOrgId: string;
  selectedOrg: Organization | null;
  setSelectedOrgId: (orgId: string) => void;
  isLoading: boolean;
  error: string | null;
  refreshUserInfo: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error("useOrganization must be used within an OrganizationProvider");
  }
  return context;
}

interface OrganizationProviderProps {
  children: ReactNode;
}

export function OrganizationProvider({ children }: OrganizationProviderProps) {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedOrg = userInfo?.organizations.find(org => org.id === selectedOrgId) || null;

  const fetchUserInfo = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await internalFetch("/api/backend/me");

      if (!response.ok) {
        // Handle HTTP errors with specific messages
        // Note: 401/403 are now handled globally by internalFetch
        if (response.status >= 500) {
          throw new Error("Server error. Please try again in a few moments.");
        } else {
          const errorText = await response.text().catch(() => "Unknown error");
          throw new Error(`Failed to load user data: ${errorText}`);
        }
      }

      const user = await response.json();

      // Validate response structure
      if (!user || typeof user !== 'object') {
        throw new Error("Invalid user data received from server");
      }

      if (!user.organizations || !Array.isArray(user.organizations)) {
        throw new Error("No organizations found for user");
      }

      setUserInfo(user);

      // Set default organization to first non-personal org, or fall back to personal
      if (user.organizations.length > 0) {
        const nonPersonalOrg = user.organizations.find((org: Organization) => !org.isPersonal);
        const defaultOrg = nonPersonalOrg ? nonPersonalOrg.id : user.organizations[0].id;

        // Use functional state updater and validate prev against refreshed list
        setSelectedOrgId(prev => {
          // Keep prev if it's truthy AND still exists in the refreshed organizations
          if (prev && user.organizations.some((org: any) => org.id === prev)) {
            return prev;
          }
          // Otherwise, set to default
          return defaultOrg;
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
      console.error("Failed to fetch user info:", errorMessage);
      setError(errorMessage);
      setUserInfo(null);
      setSelectedOrgId("");
    } finally {
      setIsLoading(false);
    }
  };

  const refreshUserInfo = async () => {
    await fetchUserInfo();
  };

  useEffect(() => {
    fetchUserInfo();
  }, []);

  return (
    <OrganizationContext.Provider
      value={{
        userInfo,
        selectedOrgId,
        selectedOrg,
        setSelectedOrgId,
        isLoading,
        error,
        refreshUserInfo,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}