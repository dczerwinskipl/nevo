using NEvo.Messaging.Context;

namespace NEvo.Messaging.Tests.Context;

public class MessageContextProviderTests
{
    [Fact]
    public void CreateContext_ReturnsMessageContext_WithExpectedProperties()
    {
        // Arrange
        var serviceProviderMock = new Mock<IServiceProvider>();
        var provider = new MessageContextProvider(serviceProviderMock.Object);

        // Act
        var context = provider.CreateContext();

        // Assert
        context.Should().NotBeNull();
        context.ServiceProvider.Should().Be(serviceProviderMock.Object);
        context.Headers.Should().NotBeNull();
    }

    [Fact]
    public void CreateContext_AlwaysReturnsTheSameInstance()
    {
        // Arrange
        var serviceProviderMock = new Mock<IServiceProvider>();
        var provider = new MessageContextProvider(serviceProviderMock.Object);

        // Act
        var context1 = provider.CreateContext();
        var context2 = provider.CreateContext();

        // Assert
        context1.Should().BeSameAs(context2);
    }

    [Fact]
    public void CreateHeaders_AlwaysReturnsTheSameInstance()
    {
        // Arrange
        var serviceProviderMock = new Mock<IServiceProvider>();
        var provider = new MessageContextProvider(serviceProviderMock.Object);

        // Act
        var headers1 = provider.CreateHeaders();
        var headers2 = provider.CreateHeaders();

        // Assert
        headers1.Should().BeEquivalentTo(headers2);
    }

    [Fact]
    public void CreateContext_AlwaysReturnsTheSameContextWithSameHeadersAsCreateHeaders()
    {
        // Arrange
        var serviceProviderMock = new Mock<IServiceProvider>();
        var provider = new MessageContextProvider(serviceProviderMock.Object);

        // Act
        var context = provider.CreateContext();
        var headers = provider.CreateHeaders();

        // Assert
        context.Headers.Should().BeEquivalentTo(headers);
    }
}
