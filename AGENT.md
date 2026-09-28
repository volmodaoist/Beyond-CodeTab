# Code Tab 项目代码风格

## 对象构造与返回

维护 `src/` 下的 TypeScript 代码时，遵循以下偏好：

- 构造结构固定的对象时，使用 `const 变量名: 类型 = { ... }`，显式标注类型，属性逐行书写。
- 函数返回新对象时，先赋给有名字、有类型的局部变量，再单独 `return`。通用解析结果可以命名为 `result`；业务对象使用 `tab`、`block`、`group` 等能表达含义的名字。
- 向数组 `push` 对象、在 `map` 回调中返回对象或向 API 传入配置对象时，也先声明具名变量，再传递或返回。
- 优先复用已有接口或第三方 API 类型；固定结构尚无类型时，补充具名 `interface` 或 `type`。
- 返回已有变量、基本类型或 `null` 时直接返回，不必再创建中间变量。导入、解构以及类型声明中的花括号不属于对象构造。
- 像语言别名表这样的动态键值映射可以继续使用 `Record`，初始化时同样分行书写。对象属性可以保留 `title` 这样的同名简写。

推荐写法：

```ts
const result: FenceLine = {
  marker: marks[0],
  length: marks.length,
  suffix: match[2],
};

return result;
```

避免将对象构造压缩为单行或直接放在返回表达式中：

```ts
return { marker: marks[0], length: marks.length, suffix: match[2] };
```

这里只要求清晰的类型、命名和分行初始化，不需要改成先创建空对象再逐个字段赋值，也不要使用类型断言绕过字段完整性检查。

## 修改与验证

调整风格时保留原有注释、业务行为和用户正在进行的改动。

- 不压行。`if`、`else`、`for`、`while` 等控制语句始终使用大括号，条件与执行语句分行书写；函数体也不要挤在一行。
- 运行 `npm run lint:fix` 自动修复代码风格；每次提交前必须运行 `npm run lint`，不能跳过检查。
- 修改源码后运行 `npm test && npm run build`，其中构建命令包含 TypeScript 类型检查；无需为纯格式和命名调整新增测试。
- `MultiTab` 管理标签与 Markdown 编辑会话，`CodeBlockEditor` 管理单代码块的围栏和高亮。组件样式放在各自目录的 `styles.css`，根样式只汇总导入。
- 组件内部直接导入相邻文件，对外通过目录 `index.ts` 导出实际需要的接口；不要为目录整理引入框架、基类或服务层。
