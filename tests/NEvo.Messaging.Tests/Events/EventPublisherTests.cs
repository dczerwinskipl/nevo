using LanguageExt;
using NEvo.Messaging.Events;
using NEvo.Messaging.Publish;
using NEvo.Messaging.Publishing;

namespace NEvo.Messaging.Tests.Events;

public class EventPublisherTests
{
    [Fact]
    public async Task PublishAsync_CallsStrategyFactory_AndPublishesEvent()
    {
        // Arrange
        var eventMock = new Mock<Event>();
        var cancellationToken = new CancellationToken(false);
        var strategyMock = new Mock<IMessagePublishStrategy>();
        var factoryMock = new Mock<IMessagePublishStrategyFactory<Event>>();
        factoryMock.Setup(f => f.CreateFor(It.IsAny<Event>())).Returns(strategyMock.Object);
        strategyMock.Setup(s => s.PublishAsync(It.IsAny<Event>(), It.IsAny<CancellationToken>()))
                    .ReturnsAsync(Either<Exception, Unit>.Right(Unit.Default));

        var publisher = new EventPublisher(factoryMock.Object);

        // Act
        var result = await publisher.PublishAsync(eventMock.Object, cancellationToken);

        // Assert
        factoryMock.Verify(f => f.CreateFor(eventMock.Object), Times.Once);
        strategyMock.Verify(s => s.PublishAsync(eventMock.Object, cancellationToken), Times.Once);
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
        strategyMock.Setup(s => s.PublishAsync(It.IsAny<Event>(), It.IsAny<CancellationToken>()))
                    .ReturnsAsync(Either<Exception, Unit>.Left(expectedException));

        var publisher = new EventPublisher(factoryMock.Object);

        // Act
        var result = await publisher.PublishAsync(eventMock.Object, cancellationToken);

        // Assert
        result.ExpectLeft().Should().Be(expectedException);
    }
}
