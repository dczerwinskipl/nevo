using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore;

namespace NEvo.Orchestrating.EntityFramework.Configurations;

public class OrchestratorStateTypeConfiguration : IEntityTypeConfiguration<OrchestratorState>
{
    private readonly string _schema;

    public OrchestratorStateTypeConfiguration()
    {
        _schema = "nEvo";
    }

    public void Configure(EntityTypeBuilder<OrchestratorState> builder)
    {
        builder.ToTable("OrchestratorStates", _schema);
        builder.HasKey(x => x.Id).IsClustered(false);
    }
}
