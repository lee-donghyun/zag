import { DateFormatter } from "@internationalized/date"
import { createMachine, guards } from "@zag-js/core"
import {
  alignDate,
  constrainValue,
  formatSelectedDate,
  getAdjustedDateFn,
  getDecadeRange,
  getEndDate,
  getNextPage,
  getNextSection,
  getPreviousPage,
  getPreviousSection,
  getTodayDate,
  isDateEqual,
  isDateOutsideVisibleRange,
  isNextVisibleRangeInvalid,
  isPreviousVisibleRangeInvalid,
  parseDateString,
  type AdjustDateReturn,
} from "@zag-js/date-utils"
import { trackDismissableElement } from "@zag-js/dismissable"
import { disableTextSelection, raf, restoreTextSelection } from "@zag-js/dom-query"
import { createLiveRegion } from "@zag-js/live-region"
import { getPlacement } from "@zag-js/popper"
import { compact, isEqual } from "@zag-js/utils"
import { dom } from "./date-picker.dom"
import type { DateValue, DateView, MachineContext, MachineState, UserDefinedContext } from "./date-picker.types"
import {
  adjustStartAndEndDate,
  clampView,
  eachView,
  getNextView,
  getPreviousView,
  isAboveMinView,
  isBelowMinView,
  isValidDate,
  sortDates,
} from "./date-picker.utils"

const { and } = guards

const transformContext = (ctx: Partial<MachineContext>): MachineContext => {
  const locale = ctx.locale || "en-US"
  const timeZone = ctx.timeZone || "UTC"
  const selectionMode = ctx.selectionMode || "single"
  const numOfMonths = ctx.numOfMonths || 1

  // sort and constrain dates
  const value = sortDates(ctx.value || []).map((date) => constrainValue(date, ctx.min, ctx.max))

  // get initial focused value
  let focusedValue = value[0] || ctx.focusedValue || getTodayDate(timeZone)
  focusedValue = constrainValue(focusedValue, ctx.min, ctx.max)

  // get initial start value for visible range
  const startValue = alignDate(focusedValue, "start", { months: numOfMonths }, locale)

  // get the initial view
  const minView: DateView = "day"
  const maxView: DateView = "year"
  const view = clampView(ctx.view || minView, minView, maxView)

  return {
    locale,
    numOfMonths,
    focusedValue,
    startValue,
    inputValue: "",
    timeZone,
    value,
    selectionMode,
    view,
    minView,
    maxView,
    activeIndex: 0,
    hoveredValue: null,
    closeOnSelect: true,
    disabled: false,
    readOnly: false,
    min: undefined,
    max: undefined,
    format(date, { locale, timeZone }) {
      const formatter = new DateFormatter(locale, { timeZone, day: "2-digit", month: "2-digit", year: "numeric" })
      return formatter.format(date.toDate(timeZone))
    },
    parse(value, { locale, timeZone }) {
      return parseDateString(value, locale, timeZone)
    },
    ...ctx,
    positioning: {
      placement: "bottom",
      ...ctx.positioning,
    },
  } as MachineContext
}

export function machine(userContext: UserDefinedContext) {
  const ctx = compact(userContext)
  return createMachine<MachineContext, MachineState>(
    {
      id: "datepicker",
      initial: ctx.open ? "open" : "idle",
      context: transformContext(ctx),
      computed: {
        isInteractive: (ctx) => !ctx.disabled && !ctx.readOnly,
        visibleDuration: (ctx) => ({ months: ctx.numOfMonths }),
        endValue: (ctx) => getEndDate(ctx.startValue, ctx.visibleDuration),
        visibleRange: (ctx) => ({ start: ctx.startValue, end: ctx.endValue }),
        visibleRangeText(ctx) {
          const formatter = new DateFormatter(ctx.locale, { month: "long", year: "numeric", timeZone: ctx.timeZone })
          const start = formatter.format(ctx.startValue.toDate(ctx.timeZone))
          const end = formatter.format(ctx.endValue.toDate(ctx.timeZone))
          const formatted = ctx.selectionMode === "range" ? `${start} - ${end}` : start
          return { start, end, formatted }
        },
        isPrevVisibleRangeValid: (ctx) => !isPreviousVisibleRangeInvalid(ctx.startValue, ctx.min, ctx.max),
        isNextVisibleRangeValid: (ctx) => !isNextVisibleRangeInvalid(ctx.endValue, ctx.min, ctx.max),
        valueAsString(ctx) {
          return ctx.value.map((date) => ctx.format(date, { locale: ctx.locale, timeZone: ctx.timeZone }))
        },
      },

      activities: ["setupLiveRegion"],

      created: ["setStartValue"],

      watch: {
        locale: ["setStartValue"],
        focusedValue: [
          "setStartValue",
          "syncMonthSelectElement",
          "syncYearSelectElement",
          "focusActiveCellIfNeeded",
          "setHoveredValueIfKeyboard",
        ],
        inputValue: ["syncInputValue"],
        value: ["syncInputElement"],
        valueAsString: ["announceValueText"],
        view: ["focusActiveCell"],
        open: ["toggleVisibility"],
      },

      on: {
        "VALUE.SET": {
          actions: ["setDateValue", "setFocusedDate"],
        },
        "VIEW.SET": {
          actions: ["setView"],
        },
        "FOCUS.SET": {
          actions: ["setFocusedDate"],
        },
        "VALUE.CLEAR": {
          actions: ["clearDateValue", "clearFocusedDate", "focusFirstInputElement"],
        },
        "INPUT.CHANGE": [
          {
            guard: "isInputValueEmpty",
            actions: ["setInputValue", "clearDateValue", "clearFocusedDate"],
          },
          {
            actions: ["setInputValue", "focusParsedDate"],
          },
        ],
        "INPUT.ENTER": {
          actions: ["focusParsedDate", "selectFocusedDate"],
        },
        "INPUT.FOCUS": {
          actions: ["setActiveIndex"],
        },
        "INPUT.BLUR": [
          {
            guard: "shouldFixOnBlur",
            actions: ["setActiveIndexToStart", "selectParsedDate"],
          },
          {
            actions: ["setActiveIndexToStart"],
          },
        ],
        "PRESET.CLICK": [
          {
            guard: "isOpenControlled",
            actions: ["setDateValue", "setFocusedDate", "invokeOnClose"],
          },
          {
            target: "focused",
            actions: ["setDateValue", "setFocusedDate", "focusInputElement"],
          },
        ],
        "GOTO.NEXT": [
          {
            guard: "isYearView",
            actions: ["focusNextDecade", "announceVisibleRange"],
          },
          {
            guard: "isMonthView",
            actions: ["focusNextYear", "announceVisibleRange"],
          },
          {
            actions: ["focusNextPage"],
          },
        ],
        "GOTO.PREV": [
          {
            guard: "isYearView",
            actions: ["focusPreviousDecade", "announceVisibleRange"],
          },
          {
            guard: "isMonthView",
            actions: ["focusPreviousYear", "announceVisibleRange"],
          },
          {
            actions: ["focusPreviousPage"],
          },
        ],
      },

      states: {
        idle: {
          tags: "closed",
          on: {
            "CONTROLLED.OPEN": {
              target: "open",
              actions: ["focusFirstSelectedDate", "focusActiveCell"],
            },
            "TRIGGER.CLICK": [
              {
                guard: "isOpenControlled",
                actions: ["invokeOnOpen"],
              },
              {
                target: "open",
                actions: ["focusFirstSelectedDate", "focusActiveCell", "invokeOnOpen"],
              },
            ],
            OPEN: [
              {
                guard: "isOpenControlled",
                actions: ["invokeOnOpen"],
              },
              {
                target: "open",
                actions: ["focusFirstSelectedDate", "focusActiveCell", "invokeOnOpen"],
              },
            ],
          },
        },

        focused: {
          tags: "closed",
          on: {
            "CONTROLLED.OPEN": {
              target: "open",
              actions: ["focusFirstSelectedDate", "focusActiveCell"],
            },
            "TRIGGER.CLICK": [
              {
                guard: "isOpenControlled",
                actions: ["invokeOnOpen"],
              },
              {
                target: "open",
                actions: ["focusFirstSelectedDate", "focusActiveCell", "invokeOnOpen"],
              },
            ],
            OPEN: [
              {
                guard: "isOpenControlled",
                actions: ["invokeOnOpen"],
              },
              {
                target: "open",
                actions: ["focusFirstSelectedDate", "focusActiveCell", "invokeOnOpen"],
              },
            ],
          },
        },

        open: {
          tags: "open",
          activities: ["trackDismissableElement", "trackPositioning"],
          exit: ["clearHoveredDate", "resetView"],
          on: {
            "CONTROLLED.CLOSE": [
              {
                guard: and("shouldRestoreFocus", "isInteractOutsideEvent"),
                target: "focused",
                actions: ["focusTriggerElement"],
              },
              {
                guard: "shouldRestoreFocus",
                target: "focused",
                actions: ["focusInputElement"],
              },
              {
                target: "idle",
              },
            ],
            "CELL.CLICK": [
              {
                guard: "isAboveMinView",
                actions: ["setFocusedValueForView", "setPreviousView"],
              },
              {
                guard: and("isRangePicker", "hasSelectedRange"),
                actions: [
                  "setActiveIndexToStart",
                  "clearDateValue",
                  "setFocusedDate",
                  "setSelectedDate",
                  "setActiveIndexToEnd",
                ],
              },
              // === Grouped transitions (based on `closeOnSelect` and `isOpenControlled`) ===
              {
                guard: and("isRangePicker", "isSelectingEndDate", "closeOnSelect", "isOpenControlled"),
                actions: [
                  "setFocusedDate",
                  "setSelectedDate",
                  "setActiveIndexToStart",
                  "invokeOnClose",
                  "setRestoreFocus",
                ],
              },
              {
                guard: and("isRangePicker", "isSelectingEndDate", "closeOnSelect"),
                target: "focused",
                actions: [
                  "setFocusedDate",
                  "setSelectedDate",
                  "setActiveIndexToStart",
                  "invokeOnClose",
                  "focusInputElement",
                ],
              },
              {
                guard: and("isRangePicker", "isSelectingEndDate"),
                actions: ["setFocusedDate", "setSelectedDate", "setActiveIndexToStart", "clearHoveredDate"],
              },
              // ===
              {
                guard: "isRangePicker",
                actions: ["setFocusedDate", "setSelectedDate", "setActiveIndexToEnd"],
              },
              {
                guard: "isMultiPicker",
                actions: ["setFocusedDate", "toggleSelectedDate"],
              },
              // === Grouped transitions (based on `closeOnSelect` and `isOpenControlled`) ===
              {
                guard: and("closeOnSelect", "isOpenControlled"),
                actions: ["setFocusedDate", "setSelectedDate", "invokeOnClose"],
              },
              {
                guard: "closeOnSelect",
                target: "focused",
                actions: ["setFocusedDate", "setSelectedDate", "invokeOnClose", "focusInputElement"],
              },
              {
                actions: ["setFocusedDate", "setSelectedDate"],
              },
              // ===
            ],
            "CELL.POINTER_MOVE": {
              guard: and("isRangePicker", "isSelectingEndDate"),
              actions: ["setHoveredDate", "setFocusedDate"],
            },
            "TABLE.POINTER_LEAVE": {
              guard: "isRangePicker",
              actions: ["clearHoveredDate"],
            },
            "TABLE.POINTER_DOWN": {
              actions: ["disableTextSelection"],
            },
            "TABLE.POINTER_UP": {
              actions: ["enableTextSelection"],
            },
            "TABLE.ESCAPE": [
              {
                guard: "isOpenControlled",
                actions: ["focusFirstSelectedDate", "invokeOnClose"],
              },
              {
                target: "focused",
                actions: ["focusFirstSelectedDate", "invokeOnClose", "focusTriggerElement"],
              },
            ],
            "TABLE.ENTER": [
              {
                guard: "isAboveMinView",
                actions: ["setPreviousView"],
              },
              {
                guard: and("isRangePicker", "hasSelectedRange"),
                actions: ["setActiveIndexToStart", "clearDateValue", "setSelectedDate", "setActiveIndexToEnd"],
              },
              // === Grouped transitions (based on `closeOnSelect` and `isOpenControlled`) ===
              {
                guard: and("isRangePicker", "isSelectingEndDate", "closeOnSelect", "isOpenControlled"),
                actions: ["setSelectedDate", "setActiveIndexToStart", "invokeOnClose"],
              },
              {
                guard: and("isRangePicker", "isSelectingEndDate", "closeOnSelect"),
                target: "focused",
                actions: ["setSelectedDate", "setActiveIndexToStart", "invokeOnClose", "focusInputElement"],
              },
              {
                guard: and("isRangePicker", "isSelectingEndDate"),
                actions: ["setSelectedDate", "setActiveIndexToStart"],
              },
              // ===
              {
                guard: "isRangePicker",
                actions: ["setSelectedDate", "setActiveIndexToEnd", "focusNextDay"],
              },
              {
                guard: "isMultiPicker",
                actions: ["toggleSelectedDate"],
              },
              // === Grouped transitions (based on `closeOnSelect` and `isOpenControlled`) ===
              {
                guard: and("closeOnSelect", "isOpenControlled"),
                actions: ["selectFocusedDate", "invokeOnClose"],
              },
              {
                guard: "closeOnSelect",
                target: "focused",
                actions: ["selectFocusedDate", "invokeOnClose", "focusInputElement"],
              },
              {
                actions: ["selectFocusedDate"],
              },
              // ===
            ],
            "TABLE.ARROW_RIGHT": [
              {
                guard: "isMonthView",
                actions: "focusNextMonth",
              },
              {
                guard: "isYearView",
                actions: "focusNextYear",
              },
              {
                actions: ["focusNextDay", "setHoveredDate"],
              },
            ],
            "TABLE.ARROW_LEFT": [
              {
                guard: "isMonthView",
                actions: "focusPreviousMonth",
              },
              {
                guard: "isYearView",
                actions: "focusPreviousYear",
              },
              {
                actions: ["focusPreviousDay"],
              },
            ],
            "TABLE.ARROW_UP": [
              {
                guard: "isMonthView",
                actions: "focusPreviousMonthColumn",
              },
              {
                guard: "isYearView",
                actions: "focusPreviousYearColumn",
              },
              {
                actions: ["focusPreviousWeek"],
              },
            ],
            "TABLE.ARROW_DOWN": [
              {
                guard: "isMonthView",
                actions: "focusNextMonthColumn",
              },
              {
                guard: "isYearView",
                actions: "focusNextYearColumn",
              },
              {
                actions: ["focusNextWeek"],
              },
            ],
            "TABLE.PAGE_UP": {
              actions: ["focusPreviousSection"],
            },
            "TABLE.PAGE_DOWN": {
              actions: ["focusNextSection"],
            },
            "TABLE.HOME": [
              {
                guard: "isMonthView",
                actions: ["focusFirstMonth"],
              },
              {
                guard: "isYearView",
                actions: ["focusFirstYear"],
              },
              {
                actions: ["focusSectionStart"],
              },
            ],
            "TABLE.END": [
              {
                guard: "isMonthView",
                actions: ["focusLastMonth"],
              },
              {
                guard: "isYearView",
                actions: ["focusLastYear"],
              },
              {
                actions: ["focusSectionEnd"],
              },
            ],
            "TRIGGER.CLICK": [
              {
                guard: "isOpenControlled",
                actions: ["invokeOnClose"],
              },
              {
                target: "focused",
                actions: ["invokeOnClose"],
              },
            ],
            "VIEW.TOGGLE": {
              actions: ["setNextView"],
            },
            INTERACT_OUTSIDE: [
              {
                guard: "isOpenControlled",
                actions: ["setActiveIndexToStart", "invokeOnClose"],
              },
              {
                guard: "shouldRestoreFocus",
                target: "focused",
                actions: ["setActiveIndexToStart", "invokeOnClose", "focusTriggerElement"],
              },
              {
                target: "idle",
                actions: ["setActiveIndexToStart", "invokeOnClose"],
              },
            ],
            CLOSE: [
              {
                guard: "isOpenControlled",
                actions: ["setActiveIndexToStart", "invokeOnClose"],
              },
              {
                target: "idle",
                actions: ["setActiveIndexToStart", "invokeOnClose"],
              },
            ],
          },
        },
      },
    },
    {
      guards: {
        isAboveMinView: (ctx) => isAboveMinView(ctx.view, ctx.minView),
        isDayView: (ctx, evt) => (evt.view || ctx.view) === "day",
        isMonthView: (ctx, evt) => (evt.view || ctx.view) === "month",
        isYearView: (ctx, evt) => (evt.view || ctx.view) === "year",
        isRangePicker: (ctx) => ctx.selectionMode === "range",
        hasSelectedRange: (ctx) => ctx.value.length === 2,
        isMultiPicker: (ctx) => ctx.selectionMode === "multiple",
        shouldRestoreFocus: (ctx) => !!ctx.restoreFocus,
        isSelectingEndDate: (ctx) => ctx.activeIndex === 1,
        closeOnSelect: (ctx) => !!ctx.closeOnSelect,
        isOpenControlled: (ctx) => !!ctx["open.controlled"],
        isInteractOutsideEvent: (_ctx, evt) => evt.previousEvent?.type === "INTERACT_OUTSIDE",
        isInputValueEmpty: (_ctx, evt) => evt.value.trim() === "",
        shouldFixOnBlur: (_ctx, evt) => !!evt.fixOnBlur,
      },

      activities: {
        trackPositioning(ctx) {
          ctx.currentPlacement ||= ctx.positioning.placement
          const anchorEl = dom.getControlEl(ctx)
          const getPositionerEl = () => dom.getPositionerEl(ctx)
          return getPlacement(anchorEl, getPositionerEl, {
            ...ctx.positioning,
            defer: true,
            onComplete(data) {
              ctx.currentPlacement = data.placement
            },
          })
        },

        setupLiveRegion(ctx) {
          const doc = dom.getDoc(ctx)
          ctx.announcer = createLiveRegion({ level: "assertive", document: doc })
          return () => ctx.announcer?.destroy?.()
        },

        trackDismissableElement(ctx, _evt, { send }) {
          const getContentEl = () => dom.getContentEl(ctx)
          return trackDismissableElement(getContentEl, {
            defer: true,
            exclude: [...dom.getInputEls(ctx), dom.getTriggerEl(ctx), dom.getClearTriggerEl(ctx)],
            onInteractOutside(event) {
              ctx.restoreFocus = !event.detail.focusable
            },
            onDismiss() {
              send({ type: "INTERACT_OUTSIDE" })
            },
            onEscapeKeyDown(event) {
              event.preventDefault()
              send({ type: "TABLE.ESCAPE", src: "dismissable" })
            },
          })
        },
      },

      actions: {
        setNextView(ctx) {
          const nextView = getNextView(ctx.view, ctx.minView, ctx.maxView)
          set.view(ctx, nextView)
        },
        setPreviousView(ctx) {
          const prevView = getPreviousView(ctx.view, ctx.minView, ctx.maxView)
          set.view(ctx, prevView)
        },
        setView(ctx, evt) {
          set.view(ctx, evt.view)
        },
        setRestoreFocus(ctx) {
          ctx.restoreFocus = true
        },
        announceValueText(ctx) {
          const announceText = ctx.value.map((date) => formatSelectedDate(date, null, ctx.locale, ctx.timeZone))
          ctx.announcer?.announce(announceText.join(","), 3000)
        },
        announceVisibleRange(ctx) {
          const { formatted } = ctx.visibleRangeText
          ctx.announcer?.announce(formatted)
        },
        disableTextSelection(ctx) {
          disableTextSelection({ target: dom.getContentEl(ctx)!, doc: dom.getDoc(ctx) })
        },
        enableTextSelection(ctx) {
          restoreTextSelection({ doc: dom.getDoc(ctx), target: dom.getContentEl(ctx)! })
        },
        focusFirstSelectedDate(ctx) {
          if (!ctx.value.length) return
          set.focusedValue(ctx, ctx.value[0])
        },
        syncInputElement(ctx) {
          raf(() => {
            const inputEls = dom.getInputEls(ctx)
            inputEls.forEach((inputEl, index) => {
              dom.setValue(inputEl, ctx.valueAsString[index] || "")
            })
          })
        },
        setFocusedDate(ctx, evt) {
          const value = Array.isArray(evt.value) ? evt.value[0] : evt.value
          set.focusedValue(ctx, value)
        },
        setFocusedValueForView(ctx, evt) {
          set.focusedValue(ctx, ctx.focusedValue.set({ [ctx.view]: evt.value }))
        },
        focusNextMonth(ctx) {
          set.focusedValue(ctx, ctx.focusedValue.add({ months: 1 }))
        },
        focusPreviousMonth(ctx) {
          set.focusedValue(ctx, ctx.focusedValue.subtract({ months: 1 }))
        },
        setDateValue(ctx, evt) {
          if (!Array.isArray(evt.value)) return
          const value = evt.value.map((date: DateValue) => constrainValue(date, ctx.min, ctx.max))
          set.value(ctx, value)
        },
        clearDateValue(ctx) {
          set.value(ctx, [])
        },
        setSelectedDate(ctx, evt) {
          const values = Array.from(ctx.value)
          values[ctx.activeIndex] = normalizeValue(ctx, evt.value ?? ctx.focusedValue)
          set.value(ctx, adjustStartAndEndDate(values))
        },
        toggleSelectedDate(ctx, evt) {
          const currentValue = normalizeValue(ctx, evt.value ?? ctx.focusedValue)
          const index = ctx.value.findIndex((date) => isDateEqual(date, currentValue))

          if (index === -1) {
            const values = [...ctx.value, currentValue]
            set.value(ctx, sortDates(values))
          } else {
            const values = Array.from(ctx.value)
            values.splice(index, 1)
            set.value(ctx, sortDates(values))
          }
        },
        setHoveredDate(ctx, evt) {
          ctx.hoveredValue = evt.value
        },
        clearHoveredDate(ctx) {
          ctx.hoveredValue = null
        },
        selectFocusedDate(ctx) {
          const values = Array.from(ctx.value)
          values[ctx.activeIndex] = ctx.focusedValue.copy()
          set.value(ctx, adjustStartAndEndDate(values))

          // always sync the input value, even if the selecteddate is not changed
          // e.g. selected value is 02/28/2024, and the input value changed to 02/28
          set.inputValue(ctx, ctx.activeIndex)
        },
        focusPreviousDay(ctx) {
          set.focusedValue(ctx, ctx.focusedValue.subtract({ days: 1 }))
        },
        focusNextDay(ctx) {
          set.focusedValue(ctx, ctx.focusedValue.add({ days: 1 }))
        },
        focusPreviousWeek(ctx) {
          set.focusedValue(ctx, ctx.focusedValue.subtract({ weeks: 1 }))
        },
        focusNextWeek(ctx) {
          set.focusedValue(ctx, ctx.focusedValue.add({ weeks: 1 }))
        },
        focusNextPage(ctx) {
          const nextPage = getNextPage(
            ctx.focusedValue,
            ctx.startValue,
            ctx.visibleDuration,
            ctx.locale,
            ctx.min,
            ctx.max,
          )

          set.adjustedValue(ctx, nextPage)
        },
        focusPreviousPage(ctx) {
          const previousPage = getPreviousPage(
            ctx.focusedValue,
            ctx.startValue,
            ctx.visibleDuration,
            ctx.locale,
            ctx.min,
            ctx.max,
          )

          set.adjustedValue(ctx, previousPage)
        },
        focusSectionStart(ctx) {
          set.focusedValue(ctx, ctx.startValue.copy())
        },
        focusSectionEnd(ctx) {
          set.focusedValue(ctx, ctx.endValue.copy())
        },
        focusNextSection(ctx, evt) {
          const nextSection = getNextSection(
            ctx.focusedValue,
            ctx.startValue,
            evt.larger,
            ctx.visibleDuration,
            ctx.locale,
            ctx.min,
            ctx.max,
          )

          if (!nextSection) return
          set.adjustedValue(ctx, nextSection)
        },
        focusPreviousSection(ctx, evt) {
          const previousSection = getPreviousSection(
            ctx.focusedValue,
            ctx.startValue,
            evt.larger,
            ctx.visibleDuration,
            ctx.locale,
            ctx.min,
            ctx.max,
          )

          if (!previousSection) return
          set.adjustedValue(ctx, previousSection)
        },
        focusNextYear(ctx) {
          set.focusedValue(ctx, ctx.focusedValue.add({ years: 1 }))
        },
        focusPreviousYear(ctx) {
          set.focusedValue(ctx, ctx.focusedValue.subtract({ years: 1 }))
        },
        focusNextDecade(ctx) {
          set.focusedValue(ctx, ctx.focusedValue.add({ years: 10 }))
        },
        focusPreviousDecade(ctx) {
          set.focusedValue(ctx, ctx.focusedValue.subtract({ years: 10 }))
        },
        clearFocusedDate(ctx) {
          set.focusedValue(ctx, getTodayDate(ctx.timeZone))
        },
        focusPreviousMonthColumn(ctx, evt) {
          set.focusedValue(ctx, ctx.focusedValue.subtract({ months: evt.columns }))
        },
        focusNextMonthColumn(ctx, evt) {
          set.focusedValue(ctx, ctx.focusedValue.add({ months: evt.columns }))
        },
        focusPreviousYearColumn(ctx, evt) {
          set.focusedValue(ctx, ctx.focusedValue.subtract({ years: evt.columns }))
        },
        focusNextYearColumn(ctx, evt) {
          set.focusedValue(ctx, ctx.focusedValue.add({ years: evt.columns }))
        },
        focusFirstMonth(ctx) {
          set.focusedValue(ctx, ctx.focusedValue.set({ month: 0 }))
        },
        focusLastMonth(ctx) {
          set.focusedValue(ctx, ctx.focusedValue.set({ month: 12 }))
        },
        focusFirstYear(ctx) {
          const range = getDecadeRange(ctx.focusedValue.year)
          set.focusedValue(ctx, ctx.focusedValue.set({ year: range[0] }))
        },
        focusLastYear(ctx) {
          const range = getDecadeRange(ctx.focusedValue.year)
          set.focusedValue(ctx, ctx.focusedValue.set({ year: range[range.length - 1] }))
        },
        setActiveIndex(ctx, evt) {
          ctx.activeIndex = evt.index
        },
        setActiveIndexToEnd(ctx) {
          ctx.activeIndex = 1
        },
        setActiveIndexToStart(ctx) {
          ctx.activeIndex = 0
        },
        focusActiveCell(ctx) {
          raf(() => {
            dom.getFocusedCell(ctx)?.focus({ preventScroll: true })
          })
        },
        focusActiveCellIfNeeded(ctx, evt) {
          if (!evt.focus) return
          raf(() => {
            dom.getFocusedCell(ctx)?.focus({ preventScroll: true })
          })
        },
        setHoveredValueIfKeyboard(ctx, evt) {
          if (!evt.type.startsWith("TABLE.ARROW") || ctx.selectionMode !== "range" || ctx.activeIndex === 0) return
          ctx.hoveredValue = ctx.focusedValue.copy()
        },
        focusTriggerElement(ctx) {
          raf(() => {
            dom.getTriggerEl(ctx)?.focus({ preventScroll: true })
          })
        },
        focusFirstInputElement(ctx) {
          raf(() => {
            const [inputEl] = dom.getInputEls(ctx)
            inputEl?.focus({ preventScroll: true })
          })
        },
        focusInputElement(ctx) {
          raf(() => {
            const inputEls = dom.getInputEls(ctx)

            const lastIndexWithValue = inputEls.findLastIndex((inputEl) => inputEl.value !== "")
            const indexToFocus = Math.max(lastIndexWithValue, 0)

            const inputEl = inputEls[indexToFocus]
            inputEl?.focus({ preventScroll: true })
            // move cursor to the end
            inputEl?.setSelectionRange(inputEl.value.length, inputEl.value.length)
          })
        },
        syncMonthSelectElement(ctx) {
          const monthSelectEl = dom.getMonthSelectEl(ctx)
          dom.setValue(monthSelectEl, ctx.startValue.month.toString())
        },
        syncYearSelectElement(ctx) {
          const yearSelectEl = dom.getYearSelectEl(ctx)
          dom.setValue(yearSelectEl, ctx.startValue.year.toString())
        },
        setInputValue(ctx, evt) {
          if (ctx.activeIndex !== evt.index) return
          ctx.inputValue = evt.value
        },
        syncInputValue(ctx, evt) {
          queueMicrotask(() => {
            const inputEls = dom.getInputEls(ctx)
            const idx = evt.index ?? ctx.activeIndex
            dom.setValue(inputEls[idx], ctx.inputValue)
          })
        },
        focusParsedDate(ctx, evt) {
          if (evt.index == null) return

          const date = ctx.parse(evt.value, { locale: ctx.locale, timeZone: ctx.timeZone })
          if (!date || !isValidDate(date)) return

          set.focusedValue(ctx, date)
        },
        selectParsedDate(ctx, evt) {
          if (evt.index == null) return

          let date = ctx.parse(evt.value, { locale: ctx.locale, timeZone: ctx.timeZone })

          // reset to last valid date
          if (!date || !isValidDate(date)) {
            if (evt.value) {
              date = ctx.focusedValue.copy()
            }
          }

          if (!date) return

          const values = Array.from(ctx.value)
          values[evt.index] = date

          set.value(ctx, values)
          // always sync the input value, even if the selecteddate is not changed
          // e.g. selected value is 02/28/2024, and the input value changed to 02/28
          set.inputValue(ctx, evt.index)
        },
        resetView(ctx, _evt, { initialContext }) {
          set.view(ctx, initialContext.view)
        },
        setStartValue(ctx) {
          const outside = isDateOutsideVisibleRange(ctx.focusedValue, ctx.startValue, ctx.endValue)
          if (!outside) return
          const startValue = alignDate(ctx.focusedValue, "start", { months: ctx.numOfMonths }, ctx.locale)
          ctx.startValue = startValue
        },
        invokeOnOpen(ctx) {
          ctx.onOpenChange?.({ open: true })
        },
        invokeOnClose(ctx) {
          ctx.onOpenChange?.({ open: false })
        },
        toggleVisibility(ctx, evt, { send }) {
          send({ type: ctx.open ? "CONTROLLED.OPEN" : "CONTROLLED.CLOSE", previousEvent: evt })
        },
      },
      compareFns: {
        startValue: isDateEqual,
        endValue: isDateEqual,
        focusedValue: isDateEqual,
        value: isDateEqualFn,
      },
    },
  )
}

const invoke = {
  change(ctx: MachineContext) {
    ctx.onValueChange?.({
      value: Array.from(ctx.value),
      valueAsString: Array.from(ctx.valueAsString),
      view: ctx.view,
    })
  },
  focusChange(ctx: MachineContext) {
    ctx.onFocusChange?.({
      focusedValue: ctx.focusedValue,
      value: Array.from(ctx.value),
      valueAsString: Array.from(ctx.valueAsString),
      view: ctx.view,
    })
  },
  viewChange(ctx: MachineContext) {
    ctx.onViewChange?.({ view: ctx.view })
  },
}

const isDateEqualFn = (a: DateValue[], b: DateValue[]) => {
  if (a.length !== b.length) return false
  return a.every((date, index) => isDateEqual(date, b[index]))
}

const normalizeValue = (ctx: MachineContext, value: number | DateValue) => {
  let dateValue = typeof value === "number" ? ctx.focusedValue.set({ [ctx.view]: value }) : value
  eachView((view) => {
    // normalize month and day
    if (isBelowMinView(view, ctx.minView)) {
      dateValue = dateValue.set({ [view]: view === "day" ? 1 : 0 })
    }
  })
  return dateValue
}

const set = {
  value(ctx: MachineContext, value: DateValue[]) {
    if (isDateEqualFn(ctx.value, value)) return
    ctx.value = value
    invoke.change(ctx)
  },

  focusedValue(ctx: MachineContext, mixedValue: DateValue | number | undefined) {
    if (!mixedValue) return

    const value = normalizeValue(ctx, mixedValue)
    if (isDateEqual(ctx.focusedValue, value)) return

    const adjustFn = getAdjustedDateFn(ctx.visibleDuration, ctx.locale, ctx.min, ctx.max)
    const adjustedValue = adjustFn({
      focusedDate: value,
      startDate: ctx.startValue,
    })

    ctx.startValue = adjustedValue.startDate
    ctx.focusedValue = adjustedValue.focusedDate

    invoke.focusChange(ctx)
  },

  adjustedValue(ctx: MachineContext, value: AdjustDateReturn) {
    ctx.startValue = value.startDate
    if (isDateEqual(ctx.focusedValue, value.focusedDate)) return

    ctx.focusedValue = value.focusedDate
    invoke.focusChange(ctx)
  },

  view(ctx: MachineContext, value: DateView) {
    if (isEqual(ctx.view, value)) return
    ctx.view = value
    invoke.viewChange(ctx)
  },

  inputValue(ctx: MachineContext, index: number) {
    const value = ctx.valueAsString[index]
    if (ctx.inputValue === value) return
    ctx.inputValue = value
  },
}
