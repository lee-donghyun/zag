import { DateFormatter, isEqualDay, isToday, isWeekend, type DateValue } from "@internationalized/date"
import {
  constrainValue,
  getDateRangePreset,
  getDayFormatter,
  getDaysInWeek,
  getDecadeRange,
  getMonthDays,
  getMonthFormatter,
  getMonthNames,
  getTodayDate,
  getUnitDuration,
  getWeekDays,
  getYearsRange,
  isDateDisabled,
  isDateEqual,
  isDateInvalid,
  isDateOutsideVisibleRange,
  isDateUnavailable,
} from "@zag-js/date-utils"
import { ariaAttr, dataAttr, getEventKey, getNativeEvent, isComposingEvent } from "@zag-js/dom-query"
import { getPlacementStyles } from "@zag-js/popper"
import type { EventKeyMap, NormalizeProps, PropTypes } from "@zag-js/types"
import { chunk, isValueWithinRange } from "@zag-js/utils"
import { parts } from "./date-picker.anatomy"
import { dom } from "./date-picker.dom"
import type {
  DayTableCellProps,
  DayTableCellState,
  MachineApi,
  Send,
  State,
  TableCellProps,
  TableCellState,
  TableProps,
} from "./date-picker.types"
import {
  adjustStartAndEndDate,
  defaultTranslations,
  ensureValidCharacters,
  getInputPlaceholder,
  getLocaleSeparator,
  getRoleDescription,
  isDateWithinRange,
  isValidCharacter,
} from "./date-picker.utils"

export function connect<T extends PropTypes>(state: State, send: Send, normalize: NormalizeProps<T>): MachineApi<T> {
  const startValue = state.context.startValue
  const endValue = state.context.endValue
  const selectedValue = state.context.value
  const focusedValue = state.context.focusedValue

  const hoveredValue = state.context.hoveredValue
  const hoveredRangeValue = hoveredValue ? adjustStartAndEndDate([selectedValue[0], hoveredValue]) : []

  const disabled = state.context.disabled
  const readOnly = state.context.readOnly
  const interactive = state.context.isInteractive

  const min = state.context.min
  const max = state.context.max
  const locale = state.context.locale
  const timeZone = state.context.timeZone
  const startOfWeek = state.context.startOfWeek

  const focused = state.matches("focused")
  const open = state.matches("open")

  const isRangePicker = state.context.selectionMode === "range"
  const isDateUnavailableFn = state.context.isDateUnavailable

  const currentPlacement = state.context.currentPlacement
  const popperStyles = getPlacementStyles({
    ...state.context.positioning,
    placement: currentPlacement,
  })

  const separator = getLocaleSeparator(locale)

  function getMonthWeeks(from = startValue) {
    const numOfWeeks = state.context.fixedWeeks ? 6 : undefined
    return getMonthDays(from, locale, numOfWeeks, startOfWeek)
  }

  function getMonths(props: { format?: "short" | "long" | undefined } = {}) {
    const { format } = props
    return getMonthNames(locale, format).map((label, index) => ({ label, value: index + 1 }))
  }

  function getYears() {
    const range = getYearsRange({ from: min?.year ?? 1900, to: max?.year ?? 2100 })
    return range.map((year) => ({ label: year.toString(), value: year }))
  }

  function getDecadeYears(year?: number) {
    const range = getDecadeRange(year ?? focusedValue.year)
    return range.map((year) => ({ label: year.toString(), value: year }))
  }

  function isUnavailable(date: DateValue) {
    return isDateUnavailable(date, isDateUnavailableFn, locale, min, max)
  }

  function focusMonth(month: number) {
    const date = startValue ?? getTodayDate(timeZone)
    send({ type: "FOCUS.SET", value: date.set({ month }) })
  }

  function focusYear(year: number) {
    const date = startValue ?? getTodayDate(timeZone)
    send({ type: "FOCUS.SET", value: date.set({ year }) })
  }

  function getYearTableCellState(props: TableCellProps): TableCellState {
    const { value, disabled } = props
    const cellState = {
      focused: focusedValue.year === props.value,
      selectable: isValueWithinRange(value, min?.year ?? 0, max?.year ?? 9999),
      selected: !!selectedValue.find((date) => date.year === value),
      valueText: value.toString(),
      get disabled() {
        return disabled || !cellState.selectable
      },
    }
    return cellState
  }

  function getMonthTableCellState(props: TableCellProps): TableCellState {
    const { value, disabled } = props
    const normalized = focusedValue.set({ month: value })
    const formatter = getMonthFormatter(locale, timeZone)
    const cellState = {
      focused: focusedValue.month === props.value,
      selectable: !isDateInvalid(normalized, min, max),
      selected: !!selectedValue.find((date) => date.month === value && date.year === focusedValue.year),
      valueText: formatter.format(normalized.toDate(timeZone)),
      get disabled() {
        return disabled || !cellState.selectable
      },
    }
    return cellState
  }

  const translations = state.context.translations || defaultTranslations

  function getDayTableCellState(props: DayTableCellProps): DayTableCellState {
    const { value, disabled, visibleRange = state.context.visibleRange } = props

    const formatter = getDayFormatter(locale, timeZone)
    const unitDuration = getUnitDuration(state.context.visibleDuration)

    const end = visibleRange.start.add(unitDuration).subtract({ days: 1 })

    const cellState = {
      invalid: isDateInvalid(value, min, max),
      disabled: disabled || isDateDisabled(value, visibleRange.start, end, min, max),
      selected: selectedValue.some((date) => isDateEqual(value, date)),
      unavailable: isDateUnavailable(value, isDateUnavailableFn, locale, min, max) && !disabled,
      outsideRange: isDateOutsideVisibleRange(value, visibleRange.start, end),
      inRange:
        isRangePicker && (isDateWithinRange(value, selectedValue) || isDateWithinRange(value, hoveredRangeValue)),
      firstInRange: isRangePicker && isDateEqual(value, selectedValue[0]),
      lastInRange: isRangePicker && isDateEqual(value, selectedValue[1]),
      today: isToday(value, timeZone),
      weekend: isWeekend(value, locale),
      formattedDate: formatter.format(value.toDate(timeZone)),
      get focused() {
        return isDateEqual(value, focusedValue) && !cellState.outsideRange
      },
      get ariaLabel(): string {
        return translations.dayCell(cellState)
      },
      get selectable() {
        return !cellState.disabled && !cellState.unavailable
      },
    }
    return cellState
  }

  function getTableId(props: TableProps) {
    const { view = "day", id } = props
    return [view, id].filter(Boolean).join(" ")
  }

  return {
    focused,
    open,
    view: state.context.view,
    getRangePresetValue(preset) {
      return getDateRangePreset(preset, locale, timeZone)
    },
    getDaysInWeek(week, from = startValue) {
      return getDaysInWeek(week, from, locale, startOfWeek)
    },
    getOffset(duration) {
      const from = startValue.add(duration)
      return {
        visibleRange: { start: from, end: endValue.add(duration) },
        weeks: getMonthWeeks(from),
      }
    },
    getMonthWeeks,
    isUnavailable,
    weeks: getMonthWeeks(),
    weekDays: getWeekDays(getTodayDate(timeZone), startOfWeek, timeZone, locale),
    visibleRangeText: state.context.visibleRangeText,
    value: selectedValue,
    valueAsDate: selectedValue.map((date) => date.toDate(timeZone)),
    valueAsString: state.context.valueAsString,
    focusedValue,
    focusedValueAsDate: focusedValue?.toDate(timeZone),
    focusedValueAsString: state.context.format(focusedValue, { locale, timeZone }),
    visibleRange: state.context.visibleRange,
    selectToday() {
      const value = constrainValue(getTodayDate(timeZone), min, max)
      send({ type: "VALUE.SET", value })
    },
    setValue(values) {
      const computedValue = values.map((date) => constrainValue(date, min, max))
      send({ type: "VALUE.SET", value: computedValue })
    },
    clearValue() {
      send("VALUE.CLEAR")
    },
    setFocusedValue(value) {
      send({ type: "FOCUS.SET", value })
    },
    setOpen(nextOpen) {
      if (nextOpen === open) return
      send(nextOpen ? "OPEN" : "CLOSE")
    },
    focusMonth,
    focusYear,
    getYears,
    getMonths,
    getYearsGrid(props = {}) {
      const { columns = 1 } = props
      return chunk(getDecadeYears(), columns)
    },
    getDecade() {
      const years = getDecadeRange(focusedValue.year)
      return { start: years.at(0), end: years.at(-1) }
    },
    getMonthsGrid(props = {}) {
      const { columns = 1, format } = props
      return chunk(getMonths({ format }), columns)
    },
    format(value, opts = { month: "long", year: "numeric" }) {
      return new DateFormatter(locale, opts).format(value.toDate(timeZone))
    },
    setView(view) {
      send({ type: "VIEW.SET", view })
    },
    goToNext() {
      send({ type: "GOTO.NEXT", view: state.context.view })
    },
    goToPrev() {
      send({ type: "GOTO.PREV", view: state.context.view })
    },

    getRootProps() {
      return normalize.element({
        ...parts.root.attrs,
        dir: state.context.dir,
        id: dom.getRootId(state.context),
        "data-state": open ? "open" : "closed",
        "data-disabled": dataAttr(disabled),
        "data-readonly": dataAttr(readOnly),
      })
    },

    getLabelProps(props = {}) {
      const { index = 0 } = props
      return normalize.label({
        ...parts.label.attrs,
        id: dom.getLabelId(state.context, index),
        dir: state.context.dir,
        htmlFor: dom.getInputId(state.context, index),
        "data-state": open ? "open" : "closed",
        "data-index": index,
        "data-disabled": dataAttr(disabled),
        "data-readonly": dataAttr(readOnly),
      })
    },

    getControlProps() {
      return normalize.element({
        ...parts.control.attrs,
        dir: state.context.dir,
        id: dom.getControlId(state.context),
        "data-disabled": dataAttr(disabled),
      })
    },

    getRangeTextProps() {
      return normalize.element({
        ...parts.rangeText.attrs,
        dir: state.context.dir,
      })
    },

    getContentProps() {
      return normalize.element({
        ...parts.content.attrs,
        hidden: !open,
        dir: state.context.dir,
        "data-state": open ? "open" : "closed",
        "data-placement": currentPlacement,
        id: dom.getContentId(state.context),
        tabIndex: -1,
        role: "application",
        "aria-roledescription": "datepicker",
        "aria-label": translations.content,
      })
    },

    getTableProps(props = {}) {
      const { view = "day", columns = view === "day" ? 7 : 4 } = props
      const uid = getTableId(props)
      return normalize.element({
        ...parts.table.attrs,
        role: "grid",
        "data-columns": columns,
        "aria-roledescription": getRoleDescription(view),
        id: dom.getTableId(state.context, uid),
        "aria-readonly": ariaAttr(readOnly),
        "aria-disabled": ariaAttr(disabled),
        "aria-multiselectable": ariaAttr(state.context.selectionMode !== "single"),
        "data-view": view,
        dir: state.context.dir,
        tabIndex: -1,
        onKeyDown(event) {
          if (event.defaultPrevented) return

          const keyMap: EventKeyMap = {
            Enter() {
              // if focused date is unavailable, do nothing
              if (isUnavailable(focusedValue)) return
              send({ type: "TABLE.ENTER", view, columns, focus: true })
            },
            ArrowLeft() {
              send({ type: "TABLE.ARROW_LEFT", view, columns, focus: true })
            },
            ArrowRight() {
              send({ type: "TABLE.ARROW_RIGHT", view, columns, focus: true })
            },
            ArrowUp() {
              send({ type: "TABLE.ARROW_UP", view, columns, focus: true })
            },
            ArrowDown() {
              send({ type: "TABLE.ARROW_DOWN", view, columns, focus: true })
            },
            PageUp(event) {
              send({ type: "TABLE.PAGE_UP", larger: event.shiftKey, view, columns, focus: true })
            },
            PageDown(event) {
              send({ type: "TABLE.PAGE_DOWN", larger: event.shiftKey, view, columns, focus: true })
            },
            Home() {
              send({ type: "TABLE.HOME", view, columns, focus: true })
            },
            End() {
              send({ type: "TABLE.END", view, columns, focus: true })
            },
          }

          const exec = keyMap[getEventKey(event, state.context)]

          if (exec) {
            exec(event)
            event.preventDefault()
            event.stopPropagation()
          }
        },
        onPointerLeave() {
          send({ type: "TABLE.POINTER_LEAVE" })
        },
        onPointerDown() {
          send({ type: "TABLE.POINTER_DOWN", view })
        },
        onPointerUp() {
          send({ type: "TABLE.POINTER_UP", view })
        },
      })
    },

    getTableHeadProps(props = {}) {
      const { view = "day" } = props
      return normalize.element({
        ...parts.tableHead.attrs,
        "aria-hidden": true,
        dir: state.context.dir,
        "data-view": view,
        "data-disabled": dataAttr(disabled),
      })
    },

    getTableHeaderProps(props = {}) {
      const { view = "day" } = props
      return normalize.element({
        ...parts.tableHeader.attrs,
        dir: state.context.dir,
        "data-view": view,
        "data-disabled": dataAttr(disabled),
      })
    },

    getTableBodyProps(props = {}) {
      const { view = "day" } = props
      return normalize.element({
        ...parts.tableBody.attrs,
        "data-view": view,
        "data-disabled": dataAttr(disabled),
      })
    },

    getTableRowProps(props = {}) {
      const { view = "day" } = props
      return normalize.element({
        ...parts.tableRow.attrs,
        "aria-disabled": ariaAttr(disabled),
        "data-disabled": dataAttr(disabled),
        "data-view": view,
      })
    },

    getDayTableCellState,

    getDayTableCellProps(props) {
      const { value } = props
      const cellState = getDayTableCellState(props)
      return normalize.element({
        ...parts.tableCell.attrs,
        role: "gridcell",
        "aria-disabled": ariaAttr(!cellState.selectable),
        "aria-selected": cellState.selected || cellState.inRange,
        "aria-invalid": ariaAttr(cellState.invalid),
        "aria-current": cellState.today ? "date" : undefined,
        "data-value": value.toString(),
      })
    },

    getDayTableCellTriggerProps(props) {
      const { value } = props
      const cellState = getDayTableCellState(props)
      return normalize.element({
        ...parts.tableCellTrigger.attrs,
        id: dom.getCellTriggerId(state.context, value.toString()),
        role: "button",
        dir: state.context.dir,
        tabIndex: cellState.focused ? 0 : -1,
        "aria-label": cellState.ariaLabel,
        "aria-disabled": ariaAttr(!cellState.selectable),
        "aria-invalid": ariaAttr(cellState.invalid),
        "data-disabled": dataAttr(!cellState.selectable),
        "data-selected": dataAttr(cellState.selected),
        "data-value": value.toString(),
        "data-view": "day",
        "data-today": dataAttr(cellState.today),
        "data-focus": dataAttr(cellState.focused),
        "data-unavailable": dataAttr(cellState.unavailable),
        "data-range-start": dataAttr(cellState.firstInRange),
        "data-range-end": dataAttr(cellState.lastInRange),
        "data-in-range": dataAttr(cellState.inRange),
        "data-outside-range": dataAttr(cellState.outsideRange),
        "data-weekend": dataAttr(cellState.weekend),
        onClick(event) {
          if (event.defaultPrevented) return
          if (!cellState.selectable) return
          send({ type: "CELL.CLICK", cell: "day", value })
        },
        onPointerMove(event) {
          if (event.pointerType === "touch" || !cellState.selectable) return
          const focus = event.currentTarget.ownerDocument.activeElement !== event.currentTarget
          if (hoveredValue && isEqualDay(value, hoveredValue)) return
          send({ type: "CELL.POINTER_MOVE", cell: "day", value, focus })
        },
      })
    },

    getMonthTableCellState,

    getMonthTableCellProps(props) {
      const { value, columns } = props
      const cellState = getMonthTableCellState(props)
      return normalize.element({
        ...parts.tableCell.attrs,
        dir: state.context.dir,
        colSpan: columns,
        role: "gridcell",
        "aria-selected": ariaAttr(cellState.selected),
        "data-selected": dataAttr(cellState.selected),
        "aria-disabled": ariaAttr(!cellState.selectable),
        "data-value": value,
      })
    },

    getMonthTableCellTriggerProps(props) {
      const { value } = props
      const cellState = getMonthTableCellState(props)
      return normalize.element({
        ...parts.tableCellTrigger.attrs,
        dir: state.context.dir,
        role: "button",
        id: dom.getCellTriggerId(state.context, value.toString()),
        "data-selected": dataAttr(cellState.selected),
        "aria-disabled": ariaAttr(!cellState.selectable),
        "data-disabled": dataAttr(!cellState.selectable),
        "data-focus": dataAttr(cellState.focused),
        "aria-label": cellState.valueText,
        "data-view": "month",
        "data-value": value,
        tabIndex: cellState.focused ? 0 : -1,
        onClick(event) {
          if (event.defaultPrevented) return
          if (!cellState.selectable) return
          send({ type: "CELL.CLICK", cell: "month", value })
        },
      })
    },

    getYearTableCellState,

    getYearTableCellProps(props) {
      const { value, columns } = props
      const cellState = getYearTableCellState(props)
      return normalize.element({
        ...parts.tableCell.attrs,
        dir: state.context.dir,
        colSpan: columns,
        role: "gridcell",
        "aria-selected": ariaAttr(cellState.selected),
        "data-selected": dataAttr(cellState.selected),
        "aria-disabled": ariaAttr(!cellState.selectable),
        "data-value": value,
      })
    },

    getYearTableCellTriggerProps(props) {
      const { value } = props
      const cellState = getYearTableCellState(props)
      return normalize.element({
        ...parts.tableCellTrigger.attrs,
        dir: state.context.dir,
        role: "button",
        id: dom.getCellTriggerId(state.context, value.toString()),
        "data-selected": dataAttr(cellState.selected),
        "data-focus": dataAttr(cellState.focused),
        "aria-disabled": ariaAttr(!cellState.selectable),
        "data-disabled": dataAttr(!cellState.selectable),
        "aria-label": cellState.valueText,
        "data-value": value,
        "data-view": "year",
        tabIndex: cellState.focused ? 0 : -1,
        onClick(event) {
          if (event.defaultPrevented) return
          if (!cellState.selectable) return
          send({ type: "CELL.CLICK", cell: "year", value })
        },
      })
    },

    getNextTriggerProps(props = {}) {
      const { view = "day" } = props
      const isDisabled = disabled || !state.context.isNextVisibleRangeValid
      return normalize.button({
        ...parts.nextTrigger.attrs,
        dir: state.context.dir,
        id: dom.getNextTriggerId(state.context, view),
        type: "button",
        "aria-label": translations.nextTrigger(view),
        disabled: isDisabled,
        "data-disabled": dataAttr(isDisabled),
        onClick(event) {
          if (event.defaultPrevented) return
          send({ type: "GOTO.NEXT", view })
        },
      })
    },

    getPrevTriggerProps(props = {}) {
      const { view = "day" } = props
      const isDisabled = disabled || !state.context.isPrevVisibleRangeValid
      return normalize.button({
        ...parts.prevTrigger.attrs,
        dir: state.context.dir,
        id: dom.getPrevTriggerId(state.context, view),
        type: "button",
        "aria-label": translations.prevTrigger(view),
        disabled: isDisabled,
        "data-disabled": dataAttr(isDisabled),
        onClick(event) {
          if (event.defaultPrevented) return
          send({ type: "GOTO.PREV", view })
        },
      })
    },

    getClearTriggerProps() {
      return normalize.button({
        ...parts.clearTrigger.attrs,
        id: dom.getClearTriggerId(state.context),
        dir: state.context.dir,
        type: "button",
        "aria-label": translations.clearTrigger,
        hidden: !state.context.value.length,
        onClick(event) {
          if (event.defaultPrevented) return
          send("VALUE.CLEAR")
        },
      })
    },

    getTriggerProps() {
      return normalize.button({
        ...parts.trigger.attrs,
        id: dom.getTriggerId(state.context),
        dir: state.context.dir,
        type: "button",
        "data-placement": currentPlacement,
        "aria-label": translations.trigger(open),
        "aria-controls": dom.getContentId(state.context),
        "data-state": open ? "open" : "closed",
        "aria-haspopup": "grid",
        disabled,
        onClick(event) {
          if (event.defaultPrevented) return
          if (!interactive) return
          send("TRIGGER.CLICK")
        },
      })
    },

    getViewTriggerProps(props = {}) {
      const { view = "day" } = props
      return normalize.button({
        ...parts.viewTrigger.attrs,
        "data-view": view,
        dir: state.context.dir,
        id: dom.getViewTriggerId(state.context, view),
        type: "button",
        disabled,
        "aria-label": translations.viewTrigger(view),
        onClick(event) {
          if (event.defaultPrevented) return
          if (!interactive) return
          send({ type: "VIEW.TOGGLE", src: "viewTrigger" })
        },
      })
    },

    getViewControlProps(props = {}) {
      const { view = "day" } = props
      return normalize.element({
        ...parts.viewControl.attrs,
        "data-view": view,
        dir: state.context.dir,
      })
    },

    getInputProps(props = {}) {
      const { index = 0, fixOnBlur = true } = props

      return normalize.input({
        ...parts.input.attrs,
        id: dom.getInputId(state.context, index),
        autoComplete: "off",
        autoCorrect: "off",
        spellCheck: "false",
        dir: state.context.dir,
        name: state.context.name,
        "data-index": index,
        "data-state": open ? "open" : "closed",
        readOnly,
        disabled,
        placeholder: state.context.placeholder || getInputPlaceholder(locale),
        defaultValue: state.context.valueAsString[index],
        onBeforeInput(event) {
          const { data } = getNativeEvent(event)
          if (!isValidCharacter(data, separator)) {
            event.preventDefault()
          }
        },
        onFocus() {
          send({ type: "INPUT.FOCUS", index })
        },
        onBlur(event) {
          const value = event.currentTarget.value.trim()
          send({ type: "INPUT.BLUR", value, index, fixOnBlur })
        },
        onKeyDown(event) {
          if (event.defaultPrevented) return
          if (!interactive) return
          const keyMap: EventKeyMap<HTMLInputElement> = {
            Enter(event) {
              // TODO: consider form submission (with enter key)
              if (isComposingEvent(event)) return
              if (isUnavailable(state.context.focusedValue)) return
              if (event.currentTarget.value.trim() === "") return
              send({ type: "INPUT.ENTER", value: event.currentTarget.value, index })
            },
          }

          const exec = keyMap[event.key]
          if (exec) {
            exec(event)
            event.preventDefault()
          }
        },
        onInput(event) {
          const value = event.currentTarget.value
          send({ type: "INPUT.CHANGE", value: ensureValidCharacters(value, separator), index })
        },
      })
    },

    getMonthSelectProps() {
      return normalize.select({
        ...parts.monthSelect.attrs,
        id: dom.getMonthSelectId(state.context),
        "aria-label": translations.monthSelect,
        disabled,
        dir: state.context.dir,
        defaultValue: startValue.month,
        onChange(event) {
          focusMonth(Number(event.currentTarget.value))
        },
      })
    },

    getYearSelectProps() {
      return normalize.select({
        ...parts.yearSelect.attrs,
        id: dom.getYearSelectId(state.context),
        disabled,
        "aria-label": translations.yearSelect,
        dir: state.context.dir,
        defaultValue: startValue.year,
        onChange(event) {
          focusYear(Number(event.currentTarget.value))
        },
      })
    },

    getPositionerProps() {
      return normalize.element({
        id: dom.getPositionerId(state.context),
        ...parts.positioner.attrs,
        dir: state.context.dir,
        style: popperStyles.floating,
      })
    },

    getPresetTriggerProps(props) {
      const value = Array.isArray(props.value) ? props.value : getDateRangePreset(props.value, locale, timeZone)
      const valueAsString = value.map((item) => item.toDate(timeZone).toDateString())
      return normalize.button({
        ...parts.presetTrigger.attrs,
        "aria-label": translations.presetTrigger(valueAsString),
        type: "button",
        onClick(event) {
          if (event.defaultPrevented) return
          send({ type: "PRESET.CLICK", value })
        },
      })
    },
  }
}
