using System;
using LanguageExt;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Evolving;
using NEvo.Messaging.Events;

namespace NEvo.Ddd.EventSourcing.Tests;

public class AggregateDeciderEvolverIntegrationTests
{
    [Fact]
    public async Task CreateDocumentCommand_WhenProcessed_ReturnsEditableDocumentWithCorrectData()
    {
        // arrange
        var aggregate = DocumentAggregateBase.CreateEmpty(Guid.NewGuid());
        var decider = new AggregateDecider([typeof(DocumentAggregateBase)]);
        var evolver = new AggregateEvolver([typeof(DocumentAggregateBase)]);
        var command = new CreateDocument(aggregate.Id, "Data");

        // act
        var result = await aggregate.ExecuteAsync(
            decider,
            evolver,
            command,
            CancellationToken.None
        );

        // assert
        result.Should().BeRight().Which
            .Should().BeOfType<EditableDocument>().Which
            .Data.Should().Be("Data");
    }
}
