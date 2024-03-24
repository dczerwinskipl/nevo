using LanguageExt;

namespace NEvo.Core.Tests;

public class UnitExtTests
{
    [Fact]
    public async Task DefaultEitherTask_ReturnsRightWithDefaultUnit()
    {
        // Act
        var result = await UnitExt.DefaultEitherTask;

        // Assert
        result.ExpectRight().Should().Be(Unit.Default);
    }
}
