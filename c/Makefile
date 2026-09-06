# XEP Level-0 C 实现 Makefile
# 目标：8 位 MCU 交叉编译友好（无动态内存、无第三方库）

CC ?= gcc
CFLAGS ?= -Wall -Wextra -std=c99 -Os
LDFLAGS ?=

# 源文件
SRCS = xep_envelope.c xep_goal.c
OBJS = $(SRCS:.c=.o)

# 测试
TEST_SRC = test_envelope.c
TEST_BIN = test_envelope

.PHONY: all clean test

all: $(OBJS)

test: $(TEST_BIN)
	./$(TEST_BIN)

$(TEST_BIN): $(TEST_SRC) $(OBJS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<

clean:
	rm -f $(OBJS) $(TEST_BIN)
