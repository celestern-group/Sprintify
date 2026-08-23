"use client";

import { useEffect, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { authClient } from "@/lib/auth-client";

export type PickedUser = { id: string; name: string; email: string };

export function UserPicker({
  id,
  value,
  onValueChange,
  placeholder = "Search by email…",
}: {
  id?: string;
  value: PickedUser | null;
  onValueChange: (user: PickedUser | null) => void;
  placeholder?: string;
}) {
  const [inputValue, setInputValue] = useState(
    value ? `${value.name} <${value.email}>` : "",
  );
  const [items, setItems] = useState<PickedUser[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = inputValue.trim();
    if (query.length < 2) {
      setItems([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timeout = setTimeout(async () => {
      const { data } = await authClient.admin.listUsers({
        query: {
          limit: 8,
          searchField: "email",
          searchOperator: "contains",
          searchValue: query,
        },
      });
      if (cancelled) return;
      setLoading(false);
      setItems(
        (data?.users ?? []).map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
        })),
      );
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [inputValue]);

  return (
    <Combobox<PickedUser>
      items={items}
      filter={null}
      value={value}
      onValueChange={onValueChange}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      itemToStringLabel={(user) => (user ? `${user.name} <${user.email}>` : "")}
      isItemEqualToValue={(a, b) => a.id === b.id}
    >
      <ComboboxInput id={id} placeholder={placeholder} showClear />
      <ComboboxContent>
        <ComboboxList>
          <ComboboxEmpty>
            {loading
              ? "Searching…"
              : inputValue.trim().length < 2
                ? "Type at least 2 characters…"
                : "No users found."}
          </ComboboxEmpty>
          {items.map((user) => (
            <ComboboxItem key={user.id} value={user}>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </div>
            </ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
