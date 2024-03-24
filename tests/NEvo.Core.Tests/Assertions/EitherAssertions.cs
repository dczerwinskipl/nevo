using LanguageExt;
using System.Diagnostics.CodeAnalysis;

namespace NEvo.Core.Tests.Assertions;

[ExcludeFromCodeCoverage]
public static class EitherAssertions
{
    public static R ExpectRight<L, R>(this Either<L, R> either) => 
        either.Match(
            right => right,
            left =>
            {
                Assert.Fail("Expected option to be Some, but it was None.");
                throw new InvalidOperationException();
            }
        );
}
