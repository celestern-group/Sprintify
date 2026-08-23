"use client";

import { IconFolder, IconFolderOpen, IconServer } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import {
  TreeExpander,
  TreeIcon,
  TreeLabel,
  TreeNode,
  TreeNodeContent,
  TreeNodeTrigger,
  TreeProvider,
  TreeView,
} from "@/components/kibo-ui/tree";
import type { ExplorerTreeNode } from "@/lib/actions/admin-explorer";
import { cn } from "@/lib/utils";

export const ENTRY_DRAG_TYPE = "application/x-sprintify-entries";

/** The storage root's own node id — "" is the root path everywhere else. */
const ROOT_ID = "";

/** Every ancestor path of `path`, so the tree can reveal the current folder. */
function ancestors(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((_, index) => `${parts.slice(0, index + 1).join("/")}/`);
}

/** Drag-and-drop wiring shared by the root row and every folder row. */
function useDropTarget(
  target: string,
  onDropEntries: (target: string) => void,
) {
  const [over, setOver] = useState(false);

  return {
    over,
    handlers: {
      onDragOver: (event: React.DragEvent) => {
        if (!event.dataTransfer.types.includes(ENTRY_DRAG_TYPE)) return;
        event.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: React.DragEvent) => {
        if (!event.dataTransfer.types.includes(ENTRY_DRAG_TYPE)) return;
        event.preventDefault();
        setOver(false);
        onDropEntries(target);
      },
    },
  };
}

function FolderNode({
  node,
  level,
  isLast,
  parentPath,
  path,
  onNavigate,
  onExpand,
  onDropEntries,
}: {
  node: ExplorerTreeNode;
  level: number;
  isLast: boolean;
  parentPath: boolean[];
  path: string;
  onNavigate: (path: string) => void;
  onExpand: (path: string) => void;
  onDropEntries: (target: string) => void;
}) {
  const { over, handlers } = useDropTarget(node.path, onDropEntries);
  const hasChildren = node.children.length > 0;
  const current = path === node.path;

  return (
    <TreeNode
      isLast={isLast}
      level={level}
      nodeId={node.path}
      parentPath={parentPath}
    >
      <TreeNodeTrigger
        className={cn(
          "py-1.5",
          current && "bg-secondary text-secondary-foreground",
          over && "ring-2 ring-ring",
        )}
        onClick={() => {
          // The trigger toggles on click; navigating into a folder should only
          // ever open it, so re-assert the expansion after the toggle.
          onExpand(node.path);
          onNavigate(node.path);
        }}
        {...handlers}
      >
        <TreeExpander hasChildren={hasChildren} />
        <TreeIcon
          className="text-primary"
          hasChildren={hasChildren}
          // A childless folder never expands, so the folder the content pane is
          // actually inside carries the open icon on its own.
          icon={
            current ? (
              <IconFolderOpen className="size-4" />
            ) : (
              <IconFolder className="size-4" />
            )
          }
          openIcon={<IconFolderOpen className="size-4" />}
        />
        <TreeLabel className={cn(current && "font-semibold")}>
          {node.name}
        </TreeLabel>
      </TreeNodeTrigger>
      <TreeNodeContent hasChildren={hasChildren}>
        {node.children.map((child, index) => (
          <FolderNode
            isLast={index === node.children.length - 1}
            key={child.path}
            level={level + 1}
            node={child}
            onDropEntries={onDropEntries}
            onExpand={onExpand}
            onNavigate={onNavigate}
            parentPath={[...parentPath, isLast]}
            path={path}
          />
        ))}
      </TreeNodeContent>
    </TreeNode>
  );
}

/**
 * Navigation pane: the folder hierarchy of the object store, on the Kibo UI
 * Tree primitives. Folders are key prefixes, so this tree is generated from the
 * keys themselves — there is no directory table to read.
 *
 * Expansion is controlled here rather than left to the tree's own state: the
 * pane has to reveal whatever folder the content pane navigated to, without
 * collapsing the folders the user opened by hand.
 */
export function ExplorerTree({
  nodes,
  path,
  onNavigate,
  onDropEntries,
}: {
  nodes: ExplorerTreeNode[];
  path: string;
  onNavigate: (path: string) => void;
  onDropEntries: (target: string) => void;
}) {
  const [expanded, setExpanded] = useState<string[]>([ROOT_ID]);
  const root = useDropTarget("", onDropEntries);

  function expand(target: string) {
    setExpanded((current) =>
      current.includes(target) ? current : [...current, target],
    );
  }

  // Reveal whatever folder the content pane is showing.
  useEffect(() => {
    setExpanded((current) =>
      ancestors(path).every((ancestor) => current.includes(ancestor))
        ? current
        : [...new Set([...current, ...ancestors(path)])],
    );
  }, [path]);

  return (
    <TreeProvider
      className="text-sm"
      expandedIds={expanded}
      indent={14}
      onExpandedChange={setExpanded}
      onSelectionChange={() => {
        // Selection follows the current path, which navigation already owns.
      }}
      selectable={false}
      selectedIds={[path]}
    >
      <TreeView aria-label="Folders" className="p-2" role="navigation">
        <TreeNode isLast={nodes.length === 0} level={0} nodeId={ROOT_ID}>
          <TreeNodeTrigger
            className={cn(
              "py-1.5",
              path === "" && "bg-secondary text-secondary-foreground",
              root.over && "ring-2 ring-ring",
            )}
            onClick={() => {
              expand(ROOT_ID);
              onNavigate("");
            }}
            {...root.handlers}
          >
            <TreeExpander hasChildren={nodes.length > 0} />
            <TreeIcon
              className="text-primary"
              hasChildren={nodes.length > 0}
              icon={<IconServer className="size-4" />}
            />
            <TreeLabel className={cn(path === "" && "font-semibold")}>
              Storage root
            </TreeLabel>
          </TreeNodeTrigger>
          <TreeNodeContent hasChildren={nodes.length > 0}>
            {nodes.map((node, index) => (
              <FolderNode
                isLast={index === nodes.length - 1}
                key={node.path}
                level={1}
                node={node}
                onDropEntries={onDropEntries}
                onExpand={expand}
                onNavigate={onNavigate}
                parentPath={[]}
                path={path}
              />
            ))}
          </TreeNodeContent>
        </TreeNode>
      </TreeView>
      {nodes.length === 0 ? (
        <p className="px-4 pb-2 text-xs text-muted-foreground">
          No folders yet.
        </p>
      ) : null}
    </TreeProvider>
  );
}
