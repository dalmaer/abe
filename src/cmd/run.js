import { loadPipeline, PipelineExecutor } from '../utils/pipeline.js';

export const runCmd = {
  command: 'run',
  describe: 'Execute a declarative pipeline',
  builder: {
    pipeline: {
      describe: 'Path to pipeline JSON file',
      demandOption: true,
      type: 'string'
    },
    spec: {
      describe: 'Path to design spec (overrides pipeline spec)',
      type: 'string'
    },
    out: {
      describe: 'Output directory',
      type: 'string'
    },
    concurrency: {
      describe: 'Max parallel requests (global override)',
      type: 'number'
    },
    'dry-run': {
      describe: 'Show plan without executing',
      type: 'boolean',
      default: false
    }
  },
  handler: async (argv) => {
    try {
      const pipeline = await loadPipeline(argv.pipeline);
      
      const options = {
        spec: argv.spec,
        out: argv.out,
        concurrency: argv.concurrency,
        dryRun: argv['dry-run']
      };

      if (argv['dry-run']) {
        console.log('🚀 Pipeline Run - Dry Run Mode\n');
        console.log(`📋 Pipeline: ${pipeline.name}`);
        console.log(`📝 Steps: ${pipeline.steps.length}\n`);
        
        pipeline.steps.forEach((step, i) => {
          console.log(`   ${i + 1}. ${step.id} (${step.run})`);
          if (step.from) console.log(`      ├─ from: ${step.from}`);
          if (step.models) console.log(`      ├─ models: ${step.models}`);
          if (step.variants) console.log(`      ├─ variants: ${step.variants}`);
          if (step.passes) console.log(`      ├─ passes: ${step.passes}`);
          if (step.select) console.log(`      └─ select: ${JSON.stringify(step.select)}`);
        });
        
        return;
      }

      console.log(`🚀 Starting pipeline: ${pipeline.name}`);
      console.log(`📝 Total steps: ${pipeline.steps.length}\n`);

      const executor = new PipelineExecutor(pipeline, options);
      const result = await executor.execute();

      console.log('\n✅ Pipeline completed successfully!');
      console.log(`📁 Results saved to: ${result.runDir}`);
      console.log(`🏆 Steps executed: ${pipeline.steps.length}`);

    } catch (error) {
      console.error('❌ Pipeline execution failed:', error.message);
      process.exit(1);
    }
  }
};