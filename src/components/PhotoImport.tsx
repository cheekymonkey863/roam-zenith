if (uploadState.phase !== "idle") {
  const percent = uploadState.total > 0 ? Math.round((uploadState.current / uploadState.total) * 100) : 100;
  return (
    <div className="relative z-20 w-full bg-background border border-border shadow-xl rounded-2xl p-10 mb-8 flex flex-col items-center justify-center text-center">
      {uploadState.phase === "finalizing" ? (
        <Sparkles className="h-10 w-10 animate-pulse text-blue-500 mb-4" />
      ) : (
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
      )}
      <h3 className="font-display text-xl font-semibold text-foreground mb-2">
        {uploadState.phase === "reading" ? "Trip Media" : "Uploading directly to cloud..."}
      </h3>
      {uploadState.phase !== "finalizing" && (
        <p className="text-sm text-muted-foreground max-w-sm mb-6">
          {uploadState.phase === "reading"
            ? `Reading GPS data from file ${uploadState.current} of ${uploadState.total}...`
            : `Securing ${uploadState.current} of ${uploadState.total} files in the cloud...`}
        </p>
      )}
      <div className="h-3 w-full max-w-md overflow-hidden rounded-full bg-muted border border-border">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            uploadState.phase === "finalizing" ? "bg-blue-500" : "bg-primary",
          )}
          style={{ width: `${Math.max(percent, 5)}%` }}
        />
      </div>
      {uploadState.phase === "uploading" && (
        <p className="text-xs font-medium text-amber-600 mt-4">
          ⚠️ Do not switch tabs. Backgrounding this page may pause the upload.
        </p>
      )}
    </div>
  );
}
