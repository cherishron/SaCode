/**
 * 订阅管理器
 */

import type { EventType } from "./protocol/index.js";

export class SubscriptionManager {
  // eventId -> Set<clientId>
  private subscriptions: Map<string, Set<string>> = new Map();
  // clientId -> Set<eventId>
  private clientSubscriptions: Map<string, Set<string>> = new Map();

  /**
   * 订阅事件
   */
  subscribe(clientId: string, eventType: EventType): void {
    // 添加到事件订阅者列表
    let subscribers = this.subscriptions.get(eventType);
    if (!subscribers) {
      subscribers = new Set();
      this.subscriptions.set(eventType, subscribers);
    }
    subscribers.add(clientId);

    // 添加到客户端订阅列表
    let clientEvents = this.clientSubscriptions.get(clientId);
    if (!clientEvents) {
      clientEvents = new Set();
      this.clientSubscriptions.set(clientId, clientEvents);
    }
    clientEvents.add(eventType);
  }

  /**
   * 取消订阅事件
   */
  unsubscribe(clientId: string, eventType?: EventType): void {
    if (eventType) {
      // 取消特定事件订阅
      const subscribers = this.subscriptions.get(eventType);
      if (subscribers) {
        subscribers.delete(clientId);
      }

      const clientEvents = this.clientSubscriptions.get(clientId);
      if (clientEvents) {
        clientEvents.delete(eventType);
      }
    } else {
      // 取消所有订阅
      this.unsubscribeAll(clientId);
    }
  }

  /**
   * 取消客户端所有订阅
   */
  unsubscribeAll(clientId: string): void {
    const clientEvents = this.clientSubscriptions.get(clientId);
    if (clientEvents) {
      for (const eventType of clientEvents) {
        const subscribers = this.subscriptions.get(eventType);
        if (subscribers) {
          subscribers.delete(clientId);
        }
      }
      this.clientSubscriptions.delete(clientId);
    }
  }

  /**
   * 获取事件的订阅者
   */
  getSubscribers(eventType: EventType): string[] {
    const subscribers = this.subscriptions.get(eventType);
    return subscribers ? Array.from(subscribers) : [];
  }

  /**
   * 获取客户端的订阅事件
   */
  getClientSubscriptions(clientId: string): EventType[] {
    const clientEvents = this.clientSubscriptions.get(clientId);
    return clientEvents ? (Array.from(clientEvents) as EventType[]) : [];
  }

  /**
   * 获取订阅总数
   */
  size(): number {
    let count = 0;
    for (const subscribers of this.subscriptions.values()) {
      count += subscribers.size;
    }
    return count;
  }
}
