"use client";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { cn } from "@better-agent/ui/lib/utils";
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";
import type * as React from "react";

function Command({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive>) {
	return (
		<CommandPrimitive
			className={cn(
				"flex h-full w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground",
				className
			)}
			data-slot="command"
			{...props}
		/>
	);
}

/** ⌘K-style palette shell: the app's Dialog with a screen-reader-only header
 * wrapped around a Command root. Near-top placement (not centered) so the
 * list can grow/shrink without the input jumping vertically. */
function CommandDialog({
	children,
	className,
	description = "Search for a command to run…",
	title = "Command palette",
	...props
}: Omit<React.ComponentProps<typeof Dialog>, "children"> & {
	children: React.ReactNode;
	className?: string;
	description?: string;
	title?: string;
}) {
	return (
		<Dialog {...props}>
			<DialogContent
				className={cn(
					"top-24 translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg",
					className
				)}
				showCloseButton={false}
			>
				<DialogHeader className="sr-only">
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<Command>{children}</Command>
			</DialogContent>
		</Dialog>
	);
}

function CommandInput({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
	return (
		<div
			className="flex h-10 shrink-0 items-center gap-2 bg-muted/40 px-3"
			data-slot="command-input-wrapper"
		>
			<SearchIcon className="size-4 shrink-0 opacity-50" />
			<CommandPrimitive.Input
				className={cn(
					"flex h-10 w-full bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
					className
				)}
				data-slot="command-input"
				{...props}
			/>
		</div>
	);
}

function CommandList({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
	return (
		<CommandPrimitive.List
			className={cn(
				"max-h-80 scroll-py-1 overflow-y-auto overflow-x-hidden",
				className
			)}
			data-slot="command-list"
			{...props}
		/>
	);
}

function CommandEmpty({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
	return (
		<CommandPrimitive.Empty
			className={cn(
				"py-6 text-center text-muted-foreground text-sm",
				className
			)}
			data-slot="command-empty"
			{...props}
		/>
	);
}

function CommandGroup({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
	return (
		<CommandPrimitive.Group
			className={cn(
				"overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:text-xs",
				className
			)}
			data-slot="command-group"
			{...props}
		/>
	);
}

function CommandSeparator({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
	return (
		<CommandPrimitive.Separator
			className={cn("-mx-1 h-px bg-foreground/5", className)}
			data-slot="command-separator"
			{...props}
		/>
	);
}

function CommandItem({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
	return (
		<CommandPrimitive.Item
			className={cn(
				"relative flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden data-[disabled=true]:pointer-events-none data-[selected=true]:bg-muted data-[selected=true]:text-foreground data-[disabled=true]:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
				className
			)}
			data-slot="command-item"
			{...props}
		/>
	);
}

function CommandShortcut({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			className={cn(
				"ml-auto text-muted-foreground text-xs tracking-widest",
				className
			)}
			data-slot="command-shortcut"
			{...props}
		/>
	);
}

export {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
};
