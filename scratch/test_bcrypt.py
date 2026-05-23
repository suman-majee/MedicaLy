from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

try:
    # Test with a normal password
    p1 = "password123"
    h1 = hash_password(p1)
    print(f"Normal password works: {h1}")

    # Test with a long password
    p2 = "a" * 73
    h2 = hash_password(p2)
    print(f"Long password works: {h2}")
except Exception as e:
    print(f"Error: {e}")
