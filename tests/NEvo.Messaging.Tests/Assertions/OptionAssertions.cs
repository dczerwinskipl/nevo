using LanguageExt;
using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Tests.Assertions;

[ExcludeFromCodeCoverage]
public static class OptionAssertions
{
    public static T ExpectSome<T>(this Option<T> option)
    {
        return option.Match(
            some => some,
            () => {
                Assert.Fail("Expected option to be Some, but it was None.");
                throw new InvalidOperationException();
            }
        );
    }

    public static void ShouldBeNone<T>(this Option<T> option)
    {
        option.Match(
            some => Assert.Fail("Expected option to be None, but it was Some."),
            () => { } // Expected outcome
        );
    }
}
