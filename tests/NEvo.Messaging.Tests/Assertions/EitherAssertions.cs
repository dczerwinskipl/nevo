using LanguageExt;
using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Tests.Assertions;

[ExcludeFromCodeCoverage]
public static class EitherAssertions
{
    public static R ExpectRight<L, R>(this Either<L, R> either) =>
        either.Match(
            right => right,
            left =>
            {
                Assert.Fail("Expected either to be Right, but it was Left.");
                throw new InvalidOperationException();
            }
        );

    public static L ExpectLeft<L, R>(this Either<L, R> either) =>
        either.Match(
            right =>
            {
                Assert.Fail("Expected option to be Left, but it was Right.");
                throw new InvalidOperationException();
            },
            left => left
        );
}