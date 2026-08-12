using LanguageExt;
using NEvo.Core;

namespace NEvo.Core.Tests;

public class EitherAsyncExtensionsTests
{
    [Fact]
    public async Task RequireSome_Left_PassesThroughUnchanged_WithoutEvaluatingNoneFactory()
    {
        var self = EitherAsync<Exception, Option<string>>.Left(new InvalidOperationException("boom"));
        var noneCallCount = 0;

        var result = await self.RequireSome<Exception, string>(() =>
        {
            noneCallCount++;
            return new InvalidOperationException("should not be called");
        });

        result.ExpectLeft().Message.Should().Be("boom");
        noneCallCount.Should().Be(0);
    }

    [Fact]
    public async Task RequireSome_RightSome_ReturnsRightWithUnwrappedValue()
    {
        var self = EitherAsync<Exception, Option<string>>.Right(Option<string>.Some("value"));

        var result = await self.RequireSome<Exception, string>(() => new InvalidOperationException("not found"));

        result.ExpectRight().Should().Be("value");
    }

    [Fact]
    public async Task RequireSome_RightNone_ReturnsLeftFromSuppliedFactory()
    {
        var self = EitherAsync<Exception, Option<string>>.Right(Option<string>.None);

        var result = await self.RequireSome<Exception, string>(() => new InvalidOperationException("not found"));

        result.ExpectLeft().Message.Should().Be("not found");
    }
}
