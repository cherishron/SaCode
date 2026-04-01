# Python 技术栈参考模板

本模板适用于使用 Python 的后端项目。

## 技术栈识别特征

- 存在 `requirements.txt` 或 `pyproject.toml`
- 存在 `setup.py` 或 `setup.cfg`
- 存在 Python 源文件（`.py`）

## 框架识别

| 配置文件 | 依赖名 | 框架 |
|----------|--------|------|
| requirements.txt | django | Django |
| requirements.txt | fastapi | FastAPI |
| requirements.txt | flask | Flask |
| requirements.txt | sqlalchemy | SQLAlchemy |

## 目录结构

### Django 项目
```
项目根目录/
├── manage.py
├── project/
│   ├── settings.py
│   ├── urls.py
│   └── wsgi.py
├── apps/
│   └── [app]/
│       ├── models.py
│       ├── views.py
│       ├── serializers.py
│       └── urls.py
├── templates/
├── static/
└── requirements.txt
```

### FastAPI 项目
```
项目根目录/
├── app/
│   ├── main.py
│   ├── api/
│   │   └── v1/
│   │       └── endpoints/
│   ├── models/
│   ├── schemas/
│   ├── services/
│   └── core/
│       ├── config.py
│       └── security.py
├── tests/
├── alembic/
├── pyproject.toml
└── requirements.txt
```

### Flask 项目
```
项目根目录/
├── app/
│   ├── __init__.py
│   ├── models.py
│   ├── views.py
│   └── templates/
├── migrations/
├── config.py
├── requirements.txt
└── run.py
```

## 核心约定

### 代码风格
```python
# 使用 Black 格式化
# 使用 isort 排序导入
# 使用 flake8 检查

# 导入顺序
import standard_library
import third_party
import local_module
```

### 类型注解
```python
from typing import Optional, List

def get_user(user_id: int) -> Optional[User]:
    ...

def get_users() -> List[User]:
    ...
```

### 异步支持
```python
# FastAPI 异步路由
@app.get("/users/{user_id}")
async def get_user(user_id: int):
    user = await User.get(user_id)
    return user
```

## 常用命令

### 包管理
```bash
pip install -r requirements.txt    # 安装依赖
pip freeze > requirements.txt      # 导出依赖
poetry install                     # Poetry 安装
```

### 开发
```bash
python manage.py runserver         # Django 开发服务器
uvicorn app.main:app --reload      # FastAPI 开发服务器
flask run                          # Flask 开发服务器
```

### 数据库
```bash
python manage.py migrate           # Django 迁移
alembic upgrade head               # Alembic 迁移
```

### 测试
```bash
pytest                             # 运行测试
pytest --cov=app                   # 覆盖率报告
```

### 代码质量
```bash
black .                            # 格式化
isort .                            # 排序导入
flake8                             # 代码检查
mypy .                             # 类型检查
```

## 验证清单

### Prime 阶段
- [ ] 确认 Python 版本
- [ ] 确认 Web 框架
- [ ] 确认数据库方案
- [ ] 确认 ORM 方案
- [ ] 确认测试框架

### Implement 阶段
- [ ] 使用类型注解
- [ ] 遵循 PEP 8 规范
- [ ] 编写文档字符串
- [ ] 处理异常情况

### Validate 阶段
- [ ] 类型检查通过（mypy）
- [ ] 代码风格检查通过（flake8）
- [ ] 测试通过
- [ ] 文档完整

## 常见问题

### Q: 如何管理虚拟环境？

A: 推荐使用 venv 或 Poetry：
```bash
# venv
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
.venv\Scripts\activate     # Windows

# Poetry
poetry shell
```

### Q: 如何处理配置？

A: 使用环境变量：
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    secret_key: str

    class Config:
        env_file = ".env"

settings = Settings()
```

### Q: 如何处理异步数据库？

A: 使用 asyncpg + SQLAlchemy：
```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession

engine = create_async_engine("postgresql+asyncpg://...")
async with AsyncSession(engine) as session:
    ...
```
