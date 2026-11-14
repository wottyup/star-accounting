"use client";

import { useRef, useState } from "react";
import { translateValue, useAppLocale } from "@/lib/stark/i18n";
import { BottomSheet } from "@/components/stark/BottomSheet";

export type ChoicePickerOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

function chevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function ChoicePicker({
  value,
  options,
  onChange,
  ariaLabel,
  title,
  placeholder = "请选择",
  disabled = false,
  className = "",
  variant = "default",
}: {
  value: string;
  options: readonly ChoicePickerOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  title: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  variant?: "default" | "year" | "month";
}) {
  const locale = useAppLocale();
  const placeholderLabel = translateValue(placeholder, locale);
  const [open, setOpen] = useState(false);
  const [closeRequest, setCloseRequest] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedOption = options.find((option) => option.value === value);
  const hasAvailableOption = options.some((option) => !option.disabled);
  const isDisabled = disabled || !hasAvailableOption;

  function closePicker() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function selectOption(option: ChoicePickerOption) {
    if (option.disabled) return;
    onChange(option.value);
    setCloseRequest((current) => current + 1);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`stark-choice-picker-trigger ${className}`.trim()}
        aria-label={translateValue(ariaLabel, locale)}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={isDisabled}
        onClick={() => setOpen(true)}
      >
        <span>{selectedOption?.label ?? placeholderLabel}</span>
        <i>{chevronIcon()}</i>
      </button>

      {open ? (
        <BottomSheet
          title={translateValue(title, locale)}
          onClose={closePicker}
          closeRequest={closeRequest}
          className={`choice-picker-sheet choice-picker-sheet-${variant}`}
          overlayClassName="choice-picker-overlay"
          bodyClassName="choice-picker-sheet-body"
        >
          <p className="choice-picker-current" aria-live="polite">
            <span>{translateValue("当前选择", locale)}</span>
            <strong>{selectedOption?.label ?? placeholderLabel}</strong>
          </p>
          <div className={`choice-picker-options choice-picker-options-${variant}`} role="listbox" aria-label={translateValue(title, locale)}>
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  className={selected ? "selected" : ""}
                  aria-selected={selected}
                  disabled={option.disabled}
                  onClick={() => selectOption(option)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </BottomSheet>
      ) : null}
    </>
  );
}
