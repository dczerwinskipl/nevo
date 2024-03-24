using LanguageExt;
using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling.Strategies;
using NEvo.Messaging.Handling;
using System;

namespace NEvo.Messaging.Tests.Handling;

public class MessageProcessorTests
{
    private readonly Mock<IMessageProcessingStrategyFactory> _strategyFactoryMock = new();
    private readonly Mock<IMiddlewareHandler<(IMessage, IMessageContext), Either<Exception, object>>> _middlewareMock = new();
    private readonly Mock<IMessageProcessingStrategy> _strategyMock = new();
    private readonly Mock<IMessageProcessingStrategyWithResult> _strategyWithResultMock = new();
    private readonly Mock<IMessage> _messageMock = new();
    private readonly Mock<IMessage<int>> _messageWithResultMock = new();
    private readonly Mock<IMessageContext> _contextMock = new();
    private readonly MessageProcessor _sut;

    public MessageProcessorTests()
    {
        _strategyFactoryMock.Setup(f => f.CreateForMessage(_messageMock.Object, _contextMock.Object)).Returns(_strategyMock.Object);
        _strategyMock
                .Setup(s => s.ProcessMessageAsync(_messageMock.Object, _contextMock.Object, It.IsAny<CancellationToken>()))
                .ReturnsAsync(Either<Exception, Unit>.Right(Unit.Default));
        _middlewareMock
                .Setup(m => m.ExecuteAsync(It.IsAny<Func<(IMessage, IMessageContext), CancellationToken, Task<Either<Exception, object>>>>(), It.IsAny<(IMessage, IMessageContext)>(), It.IsAny<CancellationToken>()))
               .ReturnsAsync(Either<Exception, object>.Right(Unit.Default));
        _sut = new MessageProcessor(_strategyFactoryMock.Object, _middlewareMock.Object);
    }

    [Fact]
    public async Task ProcessMessageAsync_ExecutesSuccessfully_ForUnit()
    {
        // Act
        var result = await _sut.ProcessMessageAsync(_messageMock.Object, _contextMock.Object, CancellationToken.None);

        // Assert
        result.ExpectRight();
    }

    [Fact]
    public async Task ProcessMessageAsync_ReturnException_WhenMiddlewareReturnException()
    {
        // Arrange
        var exception = new Exception();
        _middlewareMock
            .Setup(m => m.ExecuteAsync(It.IsAny<Func<(IMessage, IMessageContext), CancellationToken, Task<Either<Exception, object>>>>(), It.IsAny<(IMessage, IMessageContext)>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Either<Exception, object>.Left(exception));

        // Act
        var result = await _sut.ProcessMessageAsync(_messageMock.Object, _contextMock.Object, CancellationToken.None);

        // Assert
        result.ExpectLeft().Should().Be(exception);
    }

    [Fact]
    public async Task ProcessMessageAsync_ExecutesSuccessfully_ForTResult()
    {
        var expectedValue = 42; 
        _strategyWithResultMock.Setup(s => s.ProcessMessageWithResultAsync(_messageWithResultMock.Object, _contextMock.Object, It.IsAny<CancellationToken>())).ReturnsAsync(Either<Exception, int>.Right(expectedValue));
        _middlewareMock.Setup(m => m.ExecuteAsync(It.IsAny<Func<(IMessage, IMessageContext), CancellationToken, Task<Either<Exception, object>>>>(), It.IsAny<(IMessage, IMessageContext)>(), It.IsAny<CancellationToken>()))
                       .ReturnsAsync(Either<Exception, object>.Right(expectedValue));

        // Act
        var result = await _sut.ProcessMessageAsync(_messageWithResultMock.Object, _contextMock.Object, CancellationToken.None);

        // Assert
        result.ExpectRight().Should().Be(expectedValue);
    }

    [Fact]
    public async Task ProcessMessageAsyncc_ReturnException_WhenMiddlewareReturnExceptionForTResult()
    {
        var value = 42;
        var exception = new Exception();
        _strategyWithResultMock.Setup(s => s.ProcessMessageWithResultAsync(_messageWithResultMock.Object, _contextMock.Object, It.IsAny<CancellationToken>())).ReturnsAsync(Either<Exception, int>.Right(value));
        _middlewareMock.Setup(m => m.ExecuteAsync(It.IsAny<Func<(IMessage, IMessageContext), CancellationToken, Task<Either<Exception, object>>>>(), It.IsAny<(IMessage, IMessageContext)>(), It.IsAny<CancellationToken>()))
                       .ReturnsAsync(Either<Exception, object>.Left(exception));

        // Act
        var result = await _sut.ProcessMessageAsync(_messageWithResultMock.Object, _contextMock.Object, CancellationToken.None);

        // Assert
        result.ExpectLeft().Should().Be(exception);
    }
}
