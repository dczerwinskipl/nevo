using System.ComponentModel;
using System.Security.Claims;
using LanguageExt;

namespace NEvo.Web.Authorization.Claims;

public static class ClaimsExtensions
{
    public static IEnumerable<Claim> GetClaimValues(this IEnumerable<Claim> claims, string type)
        => claims.Where(c => MatchType(c, type));

    public static Option<string> GetClaimValue(this IEnumerable<Claim> claims, string type)
        => claims
            .Find(c => MatchType(c, type))
            .Map(c => c.Value);

    private static bool MatchType(Claim c, string type)
        => c.Type.Equals(type, StringComparison.InvariantCultureIgnoreCase);

    public static Option<T> GetClaimValue<T>(this IEnumerable<Claim> claims, string type)
        => claims.GetClaimValue(type).Bind(ConvertTo<T>);

    public static Option<T> ConvertTo<T>(string value)
    {
        try
        {
            if (string.IsNullOrEmpty(value))
                return Option<T>.None;

            var targetType = typeof(T);

            if (targetType == typeof(string))
            {
                return Option<T>.Some((T)(object)value);
            }

            var converter = TypeDescriptor.GetConverter(targetType);
            if (converter != null && converter.CanConvertFrom(typeof(string)))
            {
                return Option<T>.Some((T)converter.ConvertFromString(value)!);
            }

            return Option<T>.Some((T)Convert.ChangeType(value, targetType));
        }
        catch
        {
            return Option<T>.None;
        }
    }
}
