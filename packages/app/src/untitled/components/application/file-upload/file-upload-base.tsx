"use client";

import type { ComponentProps, ComponentPropsWithRef } from "react";
import { useId, useRef, useState } from "react";
import type { FileIcon } from "@untitledui/file-icons";
import { FileIcon as FileTypeIcon } from "@untitledui/file-icons";
import { CheckCircle, Trash01, UploadCloud02, XCircle } from "@untitledui/icons";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@b20-ui/components/base/buttons/button";
import { ButtonUtility } from "@b20-ui/components/base/buttons/button-utility";
import { ProgressBar } from "@b20-ui/components/base/progress-indicators/progress-indicators";
import { FeaturedIcon } from "@b20-ui/components/foundations/featured-icon/featured-icon";
import { cx } from "@b20-ui/utils/cx";

/**
 * Returns a human-readable file size.
 * @param bytes - The size of the file in bytes.
 * @returns A string representing the file size in a human-readable format.
 */
export const getReadableFileSize = (bytes: number) => {
    if (bytes === 0) return "0 KB";

    const suffixes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    return Math.floor(bytes / Math.pow(1024, i)) + " " + suffixes[i];
};

interface FileUploadDropZoneProps {
    /** The class name of the drop zone. */
    className?: string;
    /**
     * A hint text explaining what files can be dropped.
     */
    hint?: string;
    /**
     * Disables dropping or uploading files.
     */
    isDisabled?: boolean;
    label?: string;
    validate?: (file: File) => string | undefined;
    onErrors?: (errors: string[]) => void;
    /**
     * Specifies the types of files that the server accepts.
     * Examples: "image/*", ".pdf,image/*", "image/*,video/mpeg,application/pdf"
     */
    accept?: string;
    /**
     * Allows multiple file uploads.
     */
    allowsMultiple?: boolean;
    /**
     * Maximum file size in bytes.
     */
    maxSize?: number;
    /**
     * Callback function that is called with the list of dropped files
     * when files are dropped on the drop zone.
     */
    onDropFiles?: (files: File[]) => void;
    /**
     * Callback function that is called with the list of unaccepted files
     * when files are dropped on the drop zone.
     */
    onDropUnacceptedFiles?: (files: File[]) => void;
    /**
     * Callback function that is called with the list of files that exceed
     * the size limit when files are dropped on the drop zone.
     */
    onSizeLimitExceed?: (files: File[]) => void;
}

export const FileUploadDropZone = ({
    className,
    hint,
    isDisabled,
    label = "Adjuntar archivos",
    validate,
    onErrors,
    accept,
    allowsMultiple = true,
    maxSize,
    onDropFiles,
    onDropUnacceptedFiles,
    onSizeLimitExceed,
}: FileUploadDropZoneProps) => {
    const id = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const [isInvalid, setIsInvalid] = useState(false);
    const [isDraggingOver, setIsDraggingOver] = useState(false);

    const isFileTypeAccepted = (file: File): boolean => {
        if (!accept) return true;

        // Split the accept string into individual types
        const acceptedTypes = accept.split(",").map((type) => type.trim());

        return acceptedTypes.some((acceptedType) => {
            // Handle file extensions (e.g., .pdf, .doc)
            if (acceptedType.startsWith(".")) {
                const extension = `.${file.name.split(".").pop()?.toLowerCase()}`;
                return extension === acceptedType.toLowerCase();
            }

            // Handle wildcards (e.g., image/*)
            if (acceptedType.endsWith("/*")) {
                const typePrefix = acceptedType.split("/")[0];
                return file.type.startsWith(`${typePrefix}/`);
            }

            // Handle exact MIME types (e.g., application/pdf)
            return file.type === acceptedType;
        });
    };

    const handleDragIn = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!isDisabled && (Array.from(event.dataTransfer.types ?? []).includes("Files"))) setIsDraggingOver(true);
    };

    const handleDragOut = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingOver(false);
    };

    const processFiles = (files: File[]): void => {
        if (isDisabled) return;
        const acceptedFiles: File[] = [];
        const unacceptedFiles: File[] = [];
        const oversizedFiles: File[] = [];
        const errors: string[] = [];
        if (!allowsMultiple && files.length > 1) errors.push("Selecciona un solo archivo.");
        for (const file of allowsMultiple ? files : files.slice(0, 1)) {
            const problem = validate?.(file);
            if (problem) { errors.push(problem); continue; }
            if (maxSize && file.size > maxSize) {
                oversizedFiles.push(file);
                errors.push(`«${file.name}» supera el tamaño permitido.`);
            } else if (!isFileTypeAccepted(file)) {
                unacceptedFiles.push(file);
                errors.push(`El formato de «${file.name}» no está permitido.`);
            } else acceptedFiles.push(file);
        }
        setIsInvalid(errors.length > 0);
        onErrors?.(errors);
        if (oversizedFiles.length) onSizeLimitExceed?.(oversizedFiles);
        if (unacceptedFiles.length) onDropUnacceptedFiles?.(unacceptedFiles);
        if (acceptedFiles.length) onDropFiles?.(acceptedFiles);

        // Clear the input value to ensure the same file can be selected again
        if (inputRef.current) {
            inputRef.current.value = "";
        }
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDraggingOver(false);
        if (!isDisabled) processFiles(Array.from(event.dataTransfer.files));
    };

    const handleInputFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        processFiles(Array.from(event.target.files || []));
    };

    return (
        <div
            data-dropzone
            onDragOver={handleDragIn}
            onDragEnter={handleDragIn}
            onDragLeave={handleDragOut}
            onDragEnd={handleDragOut}
            onDrop={handleDrop}
            className={cx(
                "relative flex flex-col items-center gap-3 rounded-xl bg-primary px-6 py-4 text-tertiary ring-1 ring-secondary transition duration-100 ease-linear ring-inset",
                isDraggingOver && "ring-2 ring-brand",
                isDisabled && "cursor-not-allowed bg-secondary",
                className,
            )}
        >
            <FeaturedIcon icon={UploadCloud02} color="gray" theme="modern" size="md" className={cx(isDisabled && "opacity-50")} />

            <div className="flex flex-col gap-1 text-center">
                <div className="flex justify-center gap-1 text-center">
                    <input
                        ref={inputRef}
                        id={id}
                        type="file"
                        aria-label={label}
                        aria-describedby={`${id}-hint`}
                        aria-invalid={isInvalid}
                        className="peer sr-only"
                        disabled={isDisabled}
                        accept={accept}
                        multiple={allowsMultiple}
                        onChange={handleInputFileChange}
                    />
                    <div className="flex cursor-pointer">
                        <Button color="link-color" size="md" isDisabled={isDisabled} onClick={() => inputRef.current?.click()}>
                            Haz clic para subir archivos
                        </Button>
                    </div>
                    <span className="text-sm max-md:hidden">o arrástralos aquí</span>
                </div>
                <p id={`${id}-hint`} className={cx("text-xs transition duration-100 ease-linear", isInvalid && "text-error-primary")}>
                    {hint || "Imágenes y documentos"}
                </p>
            </div>
        </div>
    );
};

export interface FileListItemProps {
    /** The name of the file. */
    name: string;
    /** The size of the file. */
    size: number;
    /** The upload progress of the file. */
    progress: number;
    /** Whether the file failed to upload. */
    failed?: boolean;
    state?: "selected" | "queued" | "preparing" | "uploading" | "confirming" | "complete" | "failed" | "cancelled";
    error?: string;
    onCancel?: () => void;
    isDisabled?: boolean;
    /** The type of the file. */
    type?: ComponentProps<typeof FileIcon>["type"];
    /** The class name of the file list item. */
    className?: string;
    /** The variant of the file icon. */
    fileIconVariant?: ComponentProps<typeof FileTypeIcon>["variant"];
    /** The function to call when the file is deleted. */
    onDelete?: () => void;
    /** The function to call when the file upload is retried. */
    onRetry?: () => void;
}

export const FileListItemProgressBar = ({ name, size, progress, failed, state, error, type, fileIconVariant, onDelete, onRetry, onCancel, isDisabled, className }: FileListItemProps) => {
    const current = state ?? (failed ? "failed" : progress === 100 ? "complete" : "uploading");
    const labels = { selected: "Listo para subir", queued: "En espera", preparing: "Preparando…", uploading: "Subiendo…", confirming: "Confirmando…", complete: "Completado", failed: "No se pudo subir", cancelled: "Cancelado" };
    const isComplete = current === "complete";
    const isFailed = current === "failed";
    const indeterminate = current === "preparing" || current === "confirming";
    const value = Math.max(0, Math.min(100, progress));
    return (
        <motion.li layout="position" data-upload-state={current} className={cx("relative flex gap-3 rounded-xl bg-primary p-4 ring-1 ring-secondary transition-shadow duration-100 ease-linear ring-inset", isFailed && "ring-2 ring-error", className)}>
            <FileTypeIcon className="size-10 shrink-0 dark:hidden" type={type ?? "empty"} theme="light" variant={fileIconVariant ?? "default"} />
            <FileTypeIcon className="size-10 shrink-0 not-dark:hidden" type={type ?? "empty"} theme="dark" variant={fileIconVariant ?? "default"} />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <div className="flex w-full min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-secondary" title={name}>{name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-tertiary">
                            <span>{getReadableFileSize(size)}</span><span aria-hidden="true">·</span>
                            <span className={cx("inline-flex items-center gap-1", isComplete && "text-success-primary", isFailed && "text-error-primary")}>
                                {isComplete && <CheckCircle className="size-4" aria-hidden="true" />}
                                {isFailed && <XCircle className="size-4" aria-hidden="true" />}
                                {labels[current]}
                            </span>
                        </div>
                    </div>
                    {onCancel && <ButtonUtility color="tertiary" tooltip={`Cancelar ${name}`} icon={XCircle} size="xs" onClick={onCancel} />}
                    {onDelete && <ButtonUtility color="tertiary" tooltip={`Quitar ${name}`} icon={Trash01} size="xs" isDisabled={isDisabled} onClick={onDelete} />}
                </div>
                {!isFailed && current !== "cancelled" && <div className="mt-1 w-full">
                    {indeterminate ? <div role="progressbar" aria-label={`Subida de ${name}`} aria-valuetext={labels[current]} className="h-2 w-full overflow-hidden rounded-md bg-quaternary"><div className="upload-indeterminate h-full w-1/3 rounded-md bg-fg-brand-primary" /></div>
                        : <ProgressBar label={`Subida de ${name}`} labelPosition="right" max={100} min={0} value={value} />}
                </div>}
                {error && <p className="text-xs text-error-primary" role="alert">{error}</p>}
                {(isFailed || current === "cancelled") && onRetry && <Button color="link-destructive" size="sm" isDisabled={isDisabled} onClick={onRetry} aria-label={`Reintentar ${name}`}>Reintentar</Button>}
            </div>
        </motion.li>
    );
};

export const FileListItemProgressFill = ({ name, size, progress, failed, type, fileIconVariant, onDelete, onRetry, className }: FileListItemProps) => {
    const isComplete = progress === 100;

    return (
        <motion.li layout="position" className={cx("relative flex gap-3 overflow-hidden rounded-xl bg-primary p-4", className)}>
            {/* Progress fill. */}
            <div
                style={{ transform: `translateX(-${100 - progress}%)` }}
                className={cx("absolute inset-0 size-full bg-secondary transition duration-75 ease-linear", isComplete && "opacity-0")}
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
            />
            {/* Inner ring. */}
            <div
                className={cx(
                    "absolute inset-0 size-full rounded-[inherit] ring-1 ring-secondary transition duration-100 ease-linear ring-inset",
                    failed && "ring-2 ring-error",
                )}
            />
            <FileTypeIcon className="relative size-10 shrink-0 dark:hidden" type={type ?? "empty"} theme="light" variant={fileIconVariant ?? "solid"} />
            <FileTypeIcon className="relative size-10 shrink-0 not-dark:hidden" type={type ?? "empty"} theme="dark" variant={fileIconVariant ?? "solid"} />

            <div className="relative flex min-w-0 flex-1">
                <div className="relative flex min-w-0 flex-1 flex-col items-start">
                    <div className="w-full min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-secondary">{name}</p>

                        <div className="mt-0.5 flex items-center gap-2">
                            <p className="text-sm text-tertiary">{failed ? "No se pudo subir. Inténtalo de nuevo" : getReadableFileSize(size)}</p>

                            {!failed && (
                                <>
                                    <hr className="h-3 w-px rounded-t-full rounded-b-full border-none bg-border-primary" />
                                    <div className="flex items-center gap-1">
                                        {isComplete && <CheckCircle className="size-4 stroke-[2.5px] text-fg-success-primary" />}
                                        {!isComplete && <UploadCloud02 className="size-4 stroke-[2.5px] text-fg-quaternary" />}

                                        <p className="text-sm text-tertiary">{progress}%</p>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {failed && (
                        <Button color="link-destructive" size="sm" onClick={onRetry} className="mt-1.5">
                            Reintentar
                        </Button>
                    )}
                </div>

                <ButtonUtility color="tertiary" tooltip={`Quitar ${name}`} icon={Trash01} size="xs" className="-mt-2 -mr-2 self-start" onClick={onDelete} />
            </div>
        </motion.li>
    );
};

const FileUploadRoot = (props: ComponentPropsWithRef<"div">) => (
    <div {...props} className={cx("flex flex-col gap-4", props.className)}>
        {props.children}
    </div>
);

const FileUploadList = (props: ComponentPropsWithRef<"ul">) => (
    <ul {...props} className={cx("flex flex-col gap-3", props.className)}>
        <AnimatePresence initial={false}>{props.children}</AnimatePresence>
    </ul>
);

export const FileUpload = {
    Root: FileUploadRoot,
    List: FileUploadList,
    DropZone: FileUploadDropZone,
    ListItemProgressBar: FileListItemProgressBar,
    ListItemProgressFill: FileListItemProgressFill,
};
