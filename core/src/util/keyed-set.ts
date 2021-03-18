/*
 * Copyright (C) 2018-2021 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
  A simple set data structure that uses a custom key function for equality comparisons.

  Useful for sets of non-scalar entries, where the built-in Set data structure's === comparison is not suitable.
*/
export class KeyedSet<V> {
  private map: Map<string, V>

  constructor(private keyFn: (V) => string) {
    this.map = new Map()
  }

  add(entry: V): KeyedSet<V> {
    this.map.set(this.keyFn(entry), entry)
    return this
  }

  delete(entry: V): boolean {
    return this.map.delete(this.keyFn(entry))
  }

  has(entry: V): boolean {
    return this.map.has(this.keyFn(entry))
  }

  hasKey(key: string): boolean {
    return this.map.has(key)
  }

  // Returns set members in insertion order.
  entries(): V[] {
    return Array.from(this.map.values())
  }

  size(): number {
    return this.map.size
  }

  clear(): void {
    this.map = new Map()
  }
}
