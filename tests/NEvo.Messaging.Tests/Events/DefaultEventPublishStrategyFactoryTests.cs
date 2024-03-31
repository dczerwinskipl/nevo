using NEvo.Messaging.Attributes;
using NEvo.Messaging.Events;
using NEvo.Messaging.Publish;
using NEvo.Messaging.Publishing.External;
using NEvo.Messaging.Publishing.Internal;

namespace NEvo.Messaging.Tests.Events;

public class DefaultEventPublishStrategyFactoryTests
{
    [Fact]
    public void CreateFor_ReturnsInternalStrategyForPrivateEvent()
    {
        // Arrange
        var serviceProviderMock = new Mock<IServiceProvider>();
        var internalStrategyMock = new Mock<IInternalMessagePublishStrategy>();
        var privateEvent = new PrivateEvent(); // Assume PrivateEvent is marked appropriately to be identified as private

        serviceProviderMock.Setup(sp => sp.GetService(typeof(IInternalMessagePublishStrategy)))
            .Returns(internalStrategyMock.Object);

        var factory = new DefaultEventPublishStrategyFactory(serviceProviderMock.Object);

        // Act
        var strategy = factory.CreateFor(privateEvent);

        // Assert
        strategy.Should().BeSameAs(internalStrategyMock.Object);
    }

    [Fact]
    public void CreateFor_ReturnsExternalStrategyForPublicEvent()
    {
        // Arrange
        var serviceProviderMock = new Mock<IServiceProvider>();
        var externalStrategyMock = new Mock<IExternalMessagePublishStrategy>();
        var publicEvent = new PublicEvent();

        serviceProviderMock.Setup(sp => sp.GetService(typeof(IExternalMessagePublishStrategy)))
            .Returns(externalStrategyMock.Object);

        var factory = new DefaultEventPublishStrategyFactory(serviceProviderMock.Object);

        // Act
        var strategy = factory.CreateFor(publicEvent);

        // Assert
        strategy.Should().BeSameAs(externalStrategyMock.Object);
    }

    [Fact]
    public void CreateFor_ReturnsFallbackStrategyWhenNoDedicatedServiceExists()
    {
        // Arrange
        var serviceProviderMock = new Mock<IServiceProvider>();
        var fallbackStrategyMock = new Mock<IMessagePublishStrategy>();
        var eventWithoutSpecificStrategy = new Event();

        serviceProviderMock.Setup(sp => sp.GetService(It.IsAny<Type>())).Returns(null!);
        serviceProviderMock.Setup(sp => sp.GetService(typeof(IMessagePublishStrategy)))
            .Returns(fallbackStrategyMock.Object);

        var factory = new DefaultEventPublishStrategyFactory(serviceProviderMock.Object);

        // Act
        var strategy = factory.CreateFor(eventWithoutSpecificStrategy);

        // Assert
        strategy.Should().BeSameAs(fallbackStrategyMock.Object);
    }

    [PrivateMessage]
    private record PrivateEvent : Event
    {

    }

    [PublicMessage]
    private record PublicEvent : Event
    {

    }
}
