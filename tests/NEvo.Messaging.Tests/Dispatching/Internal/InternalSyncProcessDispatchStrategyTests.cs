using LanguageExt;
using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Dispatch.Internal;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Tests.Dispatching.Internal;

public class InternalSyncProcessDispatchStrategyTests
{
    private readonly InternalSyncProcessDispatchStrategy _sut;
    private readonly Mock<IMessageProcessor> _messageProcessorMock;

    public InternalSyncProcessDispatchStrategyTests()
    {
        _messageProcessorMock = new Mock<IMessageProcessor>();
        var messageContextMock = new Mock<IMessageContext>();
        var messageContextFactoryMock = new Mock<IMessageContextProvider>();
        messageContextFactoryMock.Setup(mcf => mcf.CreateContext()).Returns(messageContextMock.Object);
        _sut = new InternalSyncProcessDispatchStrategy(_messageProcessorMock.Object, messageContextFactoryMock.Object);
    }

    [Fact]
    public async Task DispatchAsync_ForwardsCallToMessageProcessor_WithoutResult()
    {
        // Arrange
        var messageMock = new Mock<IMessage>();
        var cancellationToken = new CancellationToken();
        var expected = UnitExt.DefaultEitherTask;
        _messageProcessorMock.Setup(mp => mp.ProcessMessageAsync(messageMock.Object, It.IsAny<IMessageContext>(), cancellationToken))
            .Returns(expected);

        // Act
        var result = await _sut.DispatchAsync(messageMock.Object, cancellationToken);

        // Assert
        result.Should().BeEquivalentTo(await expected);
        _messageProcessorMock.Verify(mp => mp.ProcessMessageAsync(messageMock.Object, It.IsAny<IMessageContext>(), cancellationToken), Times.Once);
    }

    [Fact]
    public async Task DispatchAsync_ForwardsCallToMessageProcessor_WithResult()
    {
        // Arrange
        var messageMock = new Mock<IMessage<int>>();
        var cancellationToken = new CancellationToken();
        var expected = Task.FromResult(Either<Exception, int>.Right(42));
        _messageProcessorMock.Setup(mp => mp.ProcessMessageAsync(messageMock.Object, It.IsAny<IMessageContext>(), cancellationToken))
            .Returns(expected);

        // Act
        var result = await _sut.DispatchAsync(messageMock.Object, cancellationToken);

        // Assert
        result.Should().BeEquivalentTo(await expected);
        _messageProcessorMock.Verify(mp => mp.ProcessMessageAsync(messageMock.Object, It.IsAny<IMessageContext>(), cancellationToken), Times.Once);
    }
}
