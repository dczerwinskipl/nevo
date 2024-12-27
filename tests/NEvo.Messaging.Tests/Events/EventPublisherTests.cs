using LanguageExt;
using NEvo.Messaging.Context;
using NEvo.Messaging.Events;
using NEvo.Messaging.Publish;
using NEvo.Messaging.Publishing;

namespace NEvo.Messaging.Tests.Events;

public class EventPublisherTests
{
    private readonly Mock<IMessageContext> _messageContextMock = new();
    private readonly Mock<IMessageContextAccessor> _messageContextAccessorMock = new();
    private readonly Mock<IMessageContextProvider> _messageContextFactoryMock = new();

    public EventPublisherTests()
    {
        _messageContextAccessorMock
            .SetupGet(x => x.MessageContext)
            .Returns(_messageContextMock.Object);

        _messageContextFactoryMock
            .Setup(x => x.CreateContext())
            .Returns(_messageContextMock.Object);
    }

    [Fact]
    public async Task PublishAsync_CallsStrategyFactory_AndPublishesEvent()
    {
        // Arrange
        var eventMock = new Mock<Event>();
        var cancellationToken = new CancellationToken(false);
        var strategyMock = new Mock<IMessagePublishStrategy>();
        var factoryMock = new Mock<IMessagePublishStrategyFactory<Event>>();
        factoryMock.Setup(f => f.CreateFor(It.IsAny<Event>())).Returns(strategyMock.Object);
        strategyMock.Setup(s => s.PublishAsync(It.IsAny<Event>(), It.IsAny<IMessageContext>(), It.IsAny<CancellationToken>()))
                    .ReturnsAsync(Either<Exception, Unit>.Right(Unit.Default));

        var publisher = new EventPublisher(factoryMock.Object, _messageContextAccessorMock.Object, _messageContextFactoryMock.Object);

        // Act
        var result = await publisher.PublishAsync(eventMock.Object, cancellationToken);

        // Assert
        factoryMock.Verify(f => f.CreateFor(eventMock.Object), Times.Once);
        strategyMock.Verify(s => s.PublishAsync(eventMock.Object, _messageContextMock.Object, cancellationToken), Times.Once);
        result.ExpectRight().Should().Be(Unit.Default);
    }

    [Fact]
    public async Task PublishAsync_HandlesException_FromStrategy()
    {
        // Arrange
        var eventMock = new Mock<Event>();
        var cancellationToken = new CancellationToken(false);
        var strategyMock = new Mock<IMessagePublishStrategy>();
        var factoryMock = new Mock<IMessagePublishStrategyFactory<Event>>();
        var expectedException = new Exception();

        factoryMock.Setup(f => f.CreateFor(It.IsAny<Event>())).Returns(strategyMock.Object);
        strategyMock.Setup(s => s.PublishAsync(It.IsAny<Event>(), It.IsAny<IMessageContext>(), It.IsAny<CancellationToken>()))
                    .ReturnsAsync(Either<Exception, Unit>.Left(expectedException));

        var publisher = new EventPublisher(factoryMock.Object, _messageContextAccessorMock.Object, _messageContextFactoryMock.Object);

        // Act
        var result = await publisher.PublishAsync(eventMock.Object, cancellationToken);

        // Assert
        result.ExpectLeft().Should().Be(expectedException);
    }
}
