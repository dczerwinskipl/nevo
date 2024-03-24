using NEvo.Messaging.Context;

namespace NEvo.Messaging.Tests.Context;

public class MessageContextTests
{
    [Fact]
    public void Constructor_InitializesHeaders_WithNonNullDictionary()
    {
        // Arrange
        var headers = new Dictionary<string, string>
        {
            { "Key1", "Value1" },
            { "Key2", "Value2" }
        };
        var serviceProvider = new Mock<IServiceProvider>().Object;

        // Act
        var messageContext = new MessageContext(headers, serviceProvider);

        // Assert
        messageContext.Headers.Should().BeEquivalentTo(headers);
    }

    [Fact]
    public void Constructor_InitializesServiceProvider_WithNonNullServiceProvider()
    {
        // Arrange
        var headers = new Dictionary<string, string>();
        var serviceProviderMock = new Mock<IServiceProvider>();
        var serviceProvider = serviceProviderMock.Object;

        // Act
        var messageContext = new MessageContext(headers, serviceProvider);

        // Assert
        messageContext.ServiceProvider.Should().Be(serviceProvider);
    }

    [Fact]
    public void Constructor_ThrowsArgumentNullException_WhenHeadersIsNull()
    {
        // Arrange
        var serviceProvider = new Mock<IServiceProvider>().Object;

        // Act
        var act = () => new MessageContext(null!, serviceProvider);

        // Assert
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Constructor_ThrowsArgumentNullException_WhenServiceProviderIsNull()
    {
        // Arrange
        var headers = new Dictionary<string, string>();

        // Act
        var act = () => new MessageContext(headers, null!);

        // Assert
        act.Should().Throw<ArgumentNullException>();
    }
}