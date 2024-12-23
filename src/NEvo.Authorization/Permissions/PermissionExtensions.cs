namespace NEvo.Authorization.Permissions;

public static class PermissionExtensions
{
    public const string Wildcard = "*";

    public static bool AllowedForAll(this string dataScopeValue) => dataScopeValue.Equals(Wildcard);

    public static bool AllowedFor(this string dataScopeValue, string value) => dataScopeValue.AllowedForAll() || dataScopeValue.Equals(value);
}
