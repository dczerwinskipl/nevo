namespace NEvo.Core.Tests;

public class CheckTests
{
    [Fact]
    public void Null_WhenCalledWithNullValue_ShouldThrowException()
    {
        // Arrange
        string? value = null;

        // Act
        var act = () => Check.Null(value);

        // Assert
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Null_WhenCalledWithNullValueMessageAndParamName_ShouldThrowExceptionWithMessageAndParamName()
    {
        // Arrange
        string? value = null;
        string message = "message";
        string paramName = "param name";

        // Act
        var act = () => Check.Null(value, message, paramName);

        // Assert
        var exception = act.Should().Throw<ArgumentNullException>().Which;
        exception.Message.Should().Contain(message);
        exception.ParamName.Should().Be(paramName);
    }

    [Fact]
    public void Null_WhenCalledWithNonNullValue_ShouldReturnSameValue()
    {
        // Arrange
        string? expected = "test";

        // Act
        var result = Check.Null(expected);

        // Assert
        result.Should().Be(expected);
    }

    [Fact]
    public void NullOrEmpty_WhenCalledWithNullValue_ShouldThrowException()
    {
        // Arrange
        string? value = null;

        // Act
        var act = () => Check.NullOrEmpty(value);

        // Assert
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void NullOrEmpty_WhenCalledWithNullValueMessageAndParamName_ShouldThrowExceptionWithMessageAndParamName()
    {
        // Arrange
        string? value = null;
        string message = "message";
        string paramName = "param name";

        // Act
        var act = () => Check.NullOrEmpty(value, message, paramName);

        // Assert
        var exception = act.Should().Throw<ArgumentNullException>().Which;
        exception.Message.Should().Contain(message);
        exception.ParamName.Should().Be(paramName);
    }

    [Fact]
    public void NullOrEmpty_WhenCalledWithEmptyValue_ShouldThrowException()
    {
        // Arrange
        string? value = string.Empty;

        // Act
        var act = () => Check.NullOrEmpty(value);

        // Assert
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void NullOrEmpty_WhenCalledWithEmptyValueMessageAndParamName_ShouldThrowExceptionWithMessageAndParamName()
    {
        // Arrange
        string? value = string.Empty;
        string message = "message";
        string paramName = "param name";

        // Act
        var act = () => Check.NullOrEmpty(value, message, paramName);

        // Assert
        var exception = act.Should().Throw<ArgumentNullException>().Which;
        exception.Message.Should().Contain(message);
        exception.ParamName.Should().Be(paramName);
    }

    [Fact]
    public void NullOrEmpty_WhenCalledWithNonNullValue_ShouldReturnSameValue()
    {
        // Arrange
        string? expected = "test";

        // Act
        var result = Check.NullOrEmpty(expected);

        // Assert
        result.Should().Be(expected);
    }
}
