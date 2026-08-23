"use client";

import { XIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type MouseEventHandler,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Pill } from "@/components/kibo-ui/pill";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type TagsContextType = {
  value?: string;
  setValue?: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width?: number;
  setWidth?: (width: number) => void;
};

const TagsContext = createContext<TagsContextType>({
  value: undefined,
  setValue: undefined,
  open: false,
  onOpenChange: () => {},
  width: undefined,
  setWidth: undefined,
});

const useTagsContext = () => {
  const context = useContext(TagsContext);

  if (!context) {
    throw new Error("useTagsContext must be used within a TagsProvider");
  }

  return context;
};

export type TagsProps = {
  value?: string;
  setValue?: (value: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
  className?: string;
};

export const Tags = ({
  value,
  setValue,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  children,
  className,
}: TagsProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [width, setWidth] = useState<number>();
  const ref = useRef<HTMLDivElement>(null);

  const open = controlledOpen ?? uncontrolledOpen;
  const onOpenChange = controlledOnOpenChange ?? setUncontrolledOpen;

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });

    resizeObserver.observe(ref.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <TagsContext.Provider
      value={{ value, setValue, open, onOpenChange, width, setWidth }}
    >
      <Popover onOpenChange={onOpenChange} open={open}>
        <div className={cn("relative w-full", className)} ref={ref}>
          {children}
        </div>
      </Popover>
    </TagsContext.Provider>
  );
};

export type TagsTriggerProps = ComponentProps<typeof Button> & {
  placeholder?: string;
};

export const TagsTrigger = ({
  className,
  children,
  placeholder = "Select a tag...",
  ...props
}: TagsTriggerProps) => (
  <PopoverTrigger
    render={
      <Button
        className={cn("h-auto w-full justify-between p-2", className)}
        role="combobox"
        variant="outline"
        {...props}
      />
    }
  >
    <div className="flex flex-wrap items-center gap-1">
      {children}
      <span className="px-2 py-px text-muted-foreground">{placeholder}</span>
    </div>
  </PopoverTrigger>
);

export type TagsValueProps = ComponentProps<typeof Pill> & {
  onRemove?: () => void;
};

export const TagsValue = ({
  className,
  children,
  onRemove,
  ...props
}: TagsValueProps) => {
  const handleRemove: MouseEventHandler<HTMLSpanElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onRemove?.();
  };

  return (
    <Pill className={cn("flex items-center", className)} {...props}>
      {children}
      {onRemove && (
        // NOT PillButton. Values render inside the TagsTrigger button, and a
        // button's content model forbids interactive content — so this can be
        // neither a native <button> nor a role="button" span (Base UI's
        // `nativeButton={false}` would add exactly that role, and nested
        // interactive semantics are what the nesting rule exists to prevent).
        // Removal is therefore a click affordance only; keyboard users
        // deselect from the list instead. Classes mirror PillButton so the two
        // stay visually identical.
        <span
          className="-mr-1.5 grid size-4 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={handleRemove}
        >
          <XIcon className="size-3" />
          <span className="sr-only">Remove</span>
        </span>
      )}
    </Pill>
  );
};

export type TagsContentProps = ComponentProps<typeof PopoverContent>;

export const TagsContent = ({
  className,
  children,
  ...props
}: TagsContentProps) => {
  const { width } = useTagsContext();

  return (
    <PopoverContent
      className={cn("p-0", className)}
      style={{ width }}
      {...props}
    >
      <Command>{children}</Command>
    </PopoverContent>
  );
};

export type TagsInputProps = ComponentProps<typeof CommandInput>;

export const TagsInput = ({ className, ...props }: TagsInputProps) => (
  <CommandInput className={cn("h-9", className)} {...props} />
);

export type TagsListProps = ComponentProps<typeof CommandList>;

export const TagsList = ({ className, ...props }: TagsListProps) => (
  <CommandList className={cn("max-h-50", className)} {...props} />
);

export type TagsEmptyProps = ComponentProps<typeof CommandEmpty>;

export const TagsEmpty = ({
  children,
  className,
  ...props
}: TagsEmptyProps) => (
  <CommandEmpty {...props}>{children ?? "No tags found."}</CommandEmpty>
);

export type TagsGroupProps = ComponentProps<typeof CommandGroup>;

export const TagsGroup = CommandGroup;

export type TagsItemProps = ComponentProps<typeof CommandItem>;

export const TagsItem = ({ className, ...props }: TagsItemProps) => (
  <CommandItem
    className={cn("cursor-pointer items-center justify-between", className)}
    {...props}
  />
);
