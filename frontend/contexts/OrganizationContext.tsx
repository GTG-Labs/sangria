"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

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

  const selectedOrg = userInfo?.organizations.find(org => org.id === selectedOrgId) || null;

  const fetchUserInfo = async () => {
    try {
      const response = await fetch("/api/backend/me");
      if (response.ok) {
        const user = await response.json();
        setUserInfo(user);

        // Set default organization to personal org or first available
        if (user.organizations && user.organizations.length > 0) {
          const personalOrg = user.organizations.find((org: Organization) => org.isPersonal);
          const defaultOrg = personalOrg ? personalOrg.id : user.organizations[0].id;

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
      }
    } catch (err) {
      console.error("Failed to fetch user info:", err);
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
        refreshUserInfo,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}