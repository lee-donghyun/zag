import { createMachine, guards } from "@ui-machines/core"
import { trackDocumentVisibility } from "@ui-machines/dom-utils"
import { dom } from "./toast.dom"
import { MachineContext, MachineState, Options } from "./toast.types"
import { getToastDuration } from "./toast.utils"

const { not, and, or } = guards

export function createToastMachine(options: Options = {}) {
  const { type = "info", duration, id = "toast", placement = "bottom", removeDelay = 1000, ...rest } = options
  const __duration = getToastDuration(duration, type)

  return createMachine<MachineContext, MachineState>(
    {
      id,
      entry: "invokeOnEntered",
      initial: type === "loading" ? "persist" : "active",
      context: {
        id,
        type,
        remaining: __duration,
        duration: __duration,
        removeDelay,
        createdAt: Date.now(),
        placement,
        ...rest,
      },

      on: {
        UPDATE: [
          {
            guard: and("hasTypeChanged", "isLoadingType"),
            target: "persist",
            actions: ["setContext", "invokeOnUpdate"],
          },
          {
            guard: or("hasDurationChanged", "hasTypeChanged"),
            target: "active:temp",
            actions: ["setContext", "invokeOnUpdate"],
          },
          {
            actions: ["setContext", "invokeOnUpdate"],
          },
        ],
      },

      states: {
        "active:temp": {
          tags: ["visible", "updating"],
          after: {
            0: "active",
          },
        },

        persist: {
          tags: ["visible", "paused"],
          activities: "trackDocumentVisibility",
          on: {
            RESUME: {
              guard: not("isLoadingType"),
              target: "active",
              actions: ["setCreatedAt"],
            },
            DISMISS: "dismissing",
          },
        },

        active: {
          tags: ["visible"],
          activities: "trackDocumentVisibility",
          after: {
            VISIBLE_DURATION: "dismissing",
          },
          on: {
            DISMISS: "dismissing",
            PAUSE: {
              target: "persist",
              actions: "setRemainingDuration",
            },
          },
        },

        dismissing: {
          entry: "invokeOnExiting",
          after: {
            REMOVE_DELAY: {
              target: "inactive",
              actions: "notifyParentToRemove",
            },
          },
        },

        inactive: {
          entry: "invokeOnExited",
          type: "final",
        },
      },
    },
    {
      activities: {
        trackDocumentVisibility(ctx, _evt, { send }) {
          if (!ctx.pauseOnPageIdle) return
          return trackDocumentVisibility(dom.getDoc(ctx), function (hidden) {
            send(hidden ? "PAUSE" : "RESUME")
          })
        },
      },

      guards: {
        isLoadingType: (ctx, evt) => evt.toast?.type === "loading" || ctx.type === "loading",
        hasTypeChanged: (ctx, evt) => evt.toast?.type !== ctx.type,
        hasDurationChanged: (ctx, evt) => evt.toast?.duration !== ctx.duration,
      },

      delays: {
        VISIBLE_DURATION: (ctx) => ctx.remaining,
        REMOVE_DELAY: (ctx) => ctx.removeDelay,
      },

      actions: {
        setRemainingDuration(ctx) {
          ctx.remaining -= Date.now() - ctx.createdAt
        },
        setCreatedAt(ctx) {
          ctx.createdAt = Date.now()
        },
        notifyParentToRemove(_ctx, _evt, { self }) {
          self.sendParent({ type: "REMOVE_TOAST", id: self.id })
        },
        invokeOnExiting(ctx) {
          ctx.onExiting?.()
        },
        invokeOnExited(ctx) {
          ctx.onExited?.()
        },
        invokeOnEntered(ctx) {
          ctx.onEntered?.()
        },
        invokeOnUpdate(ctx) {
          ctx.onUpdate?.()
        },
        setContext(ctx, evt) {
          const { duration, type } = evt.toast
          const time = getToastDuration(duration, type)
          Object.assign(ctx, { duration: time, remaining: time, ...evt.toast })
        },
      },
    },
  )
}
