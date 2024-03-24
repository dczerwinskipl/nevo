using NEvo.Messaging.Context;

namespace NEvo.Messaging.Tests.Context;

public class MessageContextHeadersTests
{
    [Fact]
    public void Constructor_ShouldInitializeWithGivenDictionary()
    {
        // Arrange
        var initialHeaders = new Dictionary<string, string>
        {
            { "Key1", "Value1" },
            { "Key2", "Value2" }
        };

        // Act
        var headers = new MessageContextHeaders(initialHeaders);

        // Assert
        headers.Should().BeEquivalentTo(initialHeaders);
    }

    [Fact]
    public void Constructor_ShouldThrowArgumentNullException_WhenDictionaryIsNull()
    {
        // Act
        var act = () => new MessageContextHeaders(null!);

        // Assert
        act.Should().ThrowExactly<ArgumentNullException>();
    }

    [Fact]
    public void CorrelationId_ShouldCorrectlyRetrieveValue()
    {
        // Arrange
        var correlationId = "Correlation123";
        var headers = new MessageContextHeaders(new Dictionary<string, string>
        {
            { MessageContextHeaders.CorrelationIdKey, correlationId }
        });

        // Act & Assert
        headers.CorrelationId.ExpectSome().Should().Be(correlationId);
    }

    [Fact]
    public void CausationId_ShouldCorrectlyRetrieveValue()
    {
        // Arrange
        var causationIdKey = "Correlation123";
        var headers = new MessageContextHeaders(new Dictionary<string, string>
        {
            { MessageContextHeaders.CausationIdKey, causationIdKey }
        });

        // Act & Assert
        headers.CausationId.ExpectSome().Should().Be(causationIdKey);
    }

    [Fact]
    public void SettingCorrelationId_ShouldUpdateValue()
    {
        // Arrange
        var correlationId = "NewCorrelationId";
        var headers = new MessageContextHeaders(new Dictionary<string, string>());

        // Act
        headers.CorrelationId = correlationId;

        // Assert
        headers.Should().ContainKey(MessageContextHeaders.CorrelationIdKey)
               .WhoseValue.Should().Be(correlationId);
    }

    [Fact]
    public void SettingCausationId_ShouldUpdateValue()
    {
        // Arrange
        var causationId = "NewCorrelationId";
        var headers = new MessageContextHeaders(new Dictionary<string, string>());

        // Act
        headers.CausationId = causationId;

        // Assert
        headers.Should().ContainKey(MessageContextHeaders.CausationIdKey)
               .WhoseValue.Should().Be(causationId);
    }

    [Fact]
    public void SettingCorrelationIdToNone_ShouldRemoveKey()
    {
        // Arrange
        var headers = new MessageContextHeaders(new Dictionary<string, string>
        {
            { MessageContextHeaders.CorrelationIdKey, "ToRemove" }
        });

        // Act
        headers.CorrelationId = null;

        // Assert
        headers.Should().NotContainKey(MessageContextHeaders.CorrelationIdKey);
    }

    [Fact]
    public void SettingCausationIdToNone_ShouldRemoveKey()
    {
        // Arrange
        var headers = new MessageContextHeaders(new Dictionary<string, string>
        {
            { MessageContextHeaders.CausationIdKey, "ToRemove" }
        });

        // Act
        headers.CausationId = null;

        // Assert
        headers.Should().NotContainKey(MessageContextHeaders.CausationIdKey);
    }
}