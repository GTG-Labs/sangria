"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { LogOut } from "lucide-react";
import { SignOutButton } from "./SignOutButton";

interface ProfilePopoverProps {
  firstName: string | null;
  lastName: string | null;
  email: string;
  profilePictureUrl: string | null;
}

const POPOVER_WIDTH = 256;

export default function ProfilePopover({
  firstName,
  lastName,
  email,
  profilePictureUrl,
}: ProfilePopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const displayName = firstName
    ? `${firstName}${lastName ? ` ${lastName}` : ""}`
    : email;

  const initials = firstName
    ? `${firstName[0]}${lastName ? lastName[0] : ""}`
    : email[0].toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        onClick={() => {
          if (!open && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setPopoverStyle({
              position: "fixed",
              width: POPOVER_WIDTH,
              left: Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 12),
              bottom: window.innerHeight - rect.top + 8,
            });
          }
          setOpen(!open);
        }}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-zinc-100"
      >
        {profilePictureUrl ? (
          <Image
            src={profilePictureUrl}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-full"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sangria-100 text-xs font-semibold text-sangria-700">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">
            {displayName}
          </p>
          <p className="truncate text-xs text-gray-500">{email}</p>
        </div>
      </button>

      {open && (
        <div
          style={popoverStyle}
          className="z-50 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg"
        >
          <div className="mb-3 flex items-center gap-3 px-1">
            {profilePictureUrl ? (
              <Image
                src={profilePictureUrl}
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 rounded-full"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sangria-100 text-sm font-semibold text-sangria-700">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">
                {displayName}
              </p>
              <p className="truncate text-xs text-gray-500">{email}</p>
            </div>
          </div>
          <div className="border-t border-zinc-200 pt-2">
            <SignOutButton className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-zinc-100 hover:text-gray-900">
              <LogOut className="h-4 w-4" />
              Sign Out
            </SignOutButton>
          </div>
        </div>
      )}
    </div>
  );
}
