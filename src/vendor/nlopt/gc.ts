// Garbage collector for WASM objects — adapted from nlopt-js/src/GC.mjs
// Replaced `hashmap` dependency with native Map

type WasmObject = { delete(): void }

const objects = new Set<WasmObject>()
const whitelist = new Map<WasmObject, number>() // reference count

function getStaticMethods(obj: object): string[] {
  return Object.getOwnPropertyNames(obj).filter(
    (prop) => prop !== 'constructor' && typeof (obj as Record<string, unknown>)[prop] === 'function',
  )
}

export const GC = {
  add(...addList: (WasmObject | WasmObject[])[]): void {
    for (const item of addList.flat(Infinity) as WasmObject[]) {
      objects.add(item)
    }
  },

  pushException(...exceptionList: (WasmObject | WasmObject[])[]): void {
    for (const obj of exceptionList.flat(Infinity) as WasmObject[]) {
      whitelist.set(obj, (whitelist.get(obj) ?? 0) + 1)
    }
  },

  popException(...exceptionList: (WasmObject | WasmObject[])[]): void {
    for (const obj of exceptionList.flat(Infinity) as WasmObject[]) {
      const val = (whitelist.get(obj) ?? 0) - 1
      if (val <= 0) whitelist.delete(obj)
      else whitelist.set(obj, val)
    }
  },

  flush(): number {
    const flushed = [...objects].filter((obj) => !whitelist.has(obj))
    for (const obj of flushed) {
      obj.delete()
      objects.delete(obj)
    }
    return flushed.length
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initClass(classes: Set<string>, Class: any): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const NewClass = function (...args: any[]) {
      const instance = new Class(...args)
      GC.add(instance)
      return instance
    }
    const targets = [Class, Class.prototype]
    for (const obj of targets) {
      for (const method of getStaticMethods(obj)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fun = obj[method] as (...a: any[]) => any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        obj[method] = function (this: any, ...args: any[]) {
          const rtn = fun.call(this, ...args)
          if (rtn && classes.has(rtn.constructor?.name)) {
            GC.add(rtn)
          }
          return rtn
        }
      }
    }
    for (const method of getStaticMethods(Class)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(NewClass as any)[method] = Class[method]
    }
    NewClass.prototype = Class.prototype
    return NewClass
  },
}
