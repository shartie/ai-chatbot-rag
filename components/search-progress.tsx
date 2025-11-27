"use client";

import { motion } from "framer-motion";
import { CheckCircleIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { SearchProgressData } from "@/lib/types";
import { cn } from "@/lib/utils";

type SearchProgressProps = {
  progress: SearchProgressData | null;
  isComplete: boolean;
};

const stageLabels: Record<SearchProgressData["stage"], string> = {
  analyzing: "Analyzing query",
  filtering: "Applying filters",
  searching: "Searching documents",
  ranking: "Ranking results",
  complete: "Search complete",
};

const stageOrder: SearchProgressData["stage"][] = [
  "analyzing",
  "filtering",
  "searching",
  "ranking",
  "complete",
];

export function SearchProgress({ progress, isComplete }: SearchProgressProps) {
  if (!progress && !isComplete) {
    return null;
  }

  const currentStageIndex = progress
    ? stageOrder.indexOf(progress.stage)
    : stageOrder.length;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border bg-muted/30 p-4"
      initial={{ opacity: 0, y: -10 }}
    >
      <div className="mb-3 flex items-center gap-2">
        <SearchIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">Searching Documentation</span>
      </div>

      <div className="space-y-2">
        {stageOrder.slice(0, -1).map((stage, index) => {
          const isActive = progress?.stage === stage;
          const isCompleted = currentStageIndex > index || isComplete;

          return (
            <div
              className="flex items-center gap-2 text-sm"
              key={stage}
            >
              {isCompleted ? (
                <CheckCircleIcon className="size-4 text-green-500" />
              ) : isActive ? (
                <Loader2Icon className="size-4 animate-spin text-primary" />
              ) : (
                <div className="size-4 rounded-full border border-muted-foreground/30" />
              )}
              <span
                className={cn(
                  "transition-colors",
                  isActive && "text-foreground font-medium",
                  isCompleted && "text-muted-foreground",
                  !isActive && !isCompleted && "text-muted-foreground/50"
                )}
              >
                {stageLabels[stage]}
              </span>
              {isActive && progress?.message && (
                <span className="text-muted-foreground text-xs">
                  - {progress.message}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {progress?.progress !== undefined && progress.progress < 100 && (
        <div className="mt-3">
          <Progress className="h-1.5" value={progress.progress} />
        </div>
      )}
    </motion.div>
  );
}
