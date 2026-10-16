// 运行时哨兵遍历修复的独立结构回归，不替代Windows运行库构建/启动验收。
#include <cassert>
#include <cstddef>
struct Link { Link* next; Link* prev; };
struct Module { int id; Link link; };
static int visit(Link* head) {
    int count = 0;
    for (Link* it = head->next; it != head; it = it->next) {
        auto* module = reinterpret_cast<Module*>(reinterpret_cast<char*>(it) - offsetof(Module, link));
        assert(module->id > 0);
        ++count;
    }
    return count;
}
int main() {
    Link head; head.next = head.prev = &head;
    assert(visit(&head) == 0);
    Module first{1, {&head, &head}};
    head.next = head.prev = &first.link;
    assert(visit(&head) == 1);
    Module second{2, {&head, &first.link}};
    first.link.next = &second.link; head.prev = &second.link;
    assert(visit(&head) == 2);
}
