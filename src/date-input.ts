import { html, type TemplateResult } from "lit-html";
import { displayDay, parseDisplayDay } from "./dates.ts";

/** Fixed-format typing plus the browser's calendar, independent of the browser locale. */
export const dateInput = (options: Readonly<{
  label: string; value: string; min: string; max: string; change: (day: string) => void;
}>): TemplateResult => {
  const validate = (input: HTMLInputElement): string | null => {
    const day = parseDisplayDay(input.value);
    input.setCustomValidity(!day ? "Enter a valid date as DD/MM/YYYY."
      : day < options.min || day > options.max ? `Choose a date between ${displayDay(options.min)} and ${displayDay(options.max)}.` : "");
    return input.validity.valid ? day : null;
  };
  return html`<span class="date-input">
    <input class="date-input-text" type="text" aria-label=${options.label} placeholder="DD/MM/YYYY"
      inputmode="numeric" autocomplete="off" maxlength="10" required .value=${displayDay(options.value)}
      @input=${(event: Event) => {
        const input = event.target as HTMLInputElement, day = validate(input);
        if (day) { input.value = displayDay(day); if (day !== options.value) options.change(day); }
      }}
      @change=${(event: Event) => {
        const input = event.target as HTMLInputElement, day = validate(input);
        if (day) { input.value = displayDay(day); if (day !== options.value) options.change(day); }
      }} />
    <button class="date-input-calendar" type="button" aria-label="Open calendar"
      @click=${(event: Event) => {
        const picker = (event.currentTarget as HTMLElement).parentElement!.querySelector<HTMLInputElement>(".date-input-native")!;
        picker.focus({ preventScroll: true });
        picker.showPicker();
      }}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
        <rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 2v6m8-6v6M4 11h16" />
      </svg>
    </button>
    <input class="date-input-native" type="date" tabindex="-1" aria-label="Calendar date" min=${options.min} max=${options.max}
      .value=${options.value} @keydown=${(event: KeyboardEvent) => {
        // Closing the native calendar must not also close its marker dialog.
        if (event.key === "Escape") {
          event.stopPropagation();
          (event.target as HTMLElement).parentElement!.querySelector<HTMLInputElement>(".date-input-text")!.focus({ preventScroll: true });
        }
      }} @change=${(event: Event) => {
        const picker = event.target as HTMLInputElement;
        if (!picker.value || !picker.validity.valid) return;
        const input = picker.parentElement!.querySelector<HTMLInputElement>(".date-input-text")!;
        input.value = displayDay(picker.value); input.setCustomValidity(""); options.change(picker.value);
      }} />
  </span>`;
};
